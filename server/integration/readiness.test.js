'use strict';
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { configureTestEnvironment, createTestDatabase } = require('../testing/environment');
configureTestEnvironment();
const mongoose = require('mongoose');
let replica, app, base, data, tokens;
before(async () => {
  replica = await createTestDatabase();
  app = require('../App');
  const server = await app.start({ port: 0, host: '127.0.0.1', jobs: false, signals: false });
  base = `http://127.0.0.1:${server.address().port}`;
  for (const model of Object.values(mongoose.models)) await model.init();
  data = await require('../testing/seed').seedTestData();
  const jwt = require('../utils/jwt');
  tokens = Object.fromEntries(Object.entries(data.users).map(([role, user]) => [role, jwt.signTenantAccessToken({ user, tenantId: data.tenants[0]._id })]));
  tokens.portal = jwt.signCustomerPortalAccessToken({ tenant: data.tenants[0], customer: data.customers[0] });
  tokens.platform = jwt.signPlatformAccessToken({ admin: { _id: new mongoose.Types.ObjectId(), email: 'platform@example.test' } });
}, { timeout: 180000 });
after(async () => { if (app) await app.stop(); if (replica) await replica.stop(); });
async function request(url, { token, method = 'GET', body, headers = {} } = {}) {
  return fetch(base + url, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
}

test('mounted tenant routes reject missing, wrong-realm, and tampered tenant credentials', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../App.js'), 'utf8');
  const definitions = Object.fromEntries([...source.matchAll(/const (\w+) = require\("\.\/routes\/([^"\n]+)"\)/g)].map(m => [m[1], m[2]]));
  const mounts = [...source.matchAll(/app\.use\("([^"]+)", authenticate, attachTenant, (\w+)\)/g)];
  let count = 0;
  for (const mount of mounts) {
    const router = require(`../routes/${definitions[mount[2]]}`);
    for (const layer of router.stack.filter(layer => layer.route && typeof layer.route.path === 'string')) {
      const url = (mount[1] + layer.route.path.replace(/:\w+/g, '000000000000000000000001')).replace(/\/$/, '');
      for (const method of Object.keys(layer.route.methods)) {
        for (const token of [null, tokens.portal, tokens.platform]) {
          const res = await request(url, { method: method.toUpperCase(), token });
          assert.equal(res.status, 401, `${method} ${url} must reject foreign realm`);
          await res.text();
        }
        const res = await request(url, { method: method.toUpperCase(), token: tokens.owner, headers: { 'x-isp-id': String(data.tenants[1]._id) } });
        assert.equal(res.status, 403, `${method} ${url} must reject tenant substitution`);
        await res.text(); count++;
      }
    }
  }
  assert.ok(count > 150, `Expected broad route coverage, found ${count}`);
  console.log(`Authorization boundary exercised on ${count} mounted operations`);
});

test('all supported staff roles see only their own tenant data; operator cannot administer credentials or finances', async () => {
  for (const role of ['owner', 'admin', 'operator']) {
    const res = await request('/api/customers', { token: tokens[role] });
    assert.equal(res.status, 200);
    const customers = await res.json();
    assert.ok(customers.some(row => row.name === 'Amina Demo'));
    assert.ok(!customers.some(row => row.name === 'Other Subscriber'));
    assert.equal((await request(`/api/plans/${data.plans[1]._id}`, { token: tokens[role] })).status, 404);
  }
  for (const url of ['/api/payment-config', '/api/api-keys', '/api/finance/summary', '/api/audit-logs']) {
    assert.equal((await request(url, { token: tokens.operator })).status, 403, url);
  }
  assert.equal((await request('/api/customers', { headers: { Cookie: `at=${tokens.owner}` } })).status, 401);
});

test('portal contact values cannot log in; challenge is bounded, one-use, and revokes old sessions', async () => {
  const Customer = require('../models/customers');
  const { issuePortalChallenge, completePortalChallenge } = require('../services/portalChallengeService');
  const unknown = await issuePortalChallenge({ tenant: null, customer: null });
  assert.equal(unknown.challengeId.length, 48);
  assert.equal((await request('/portal-api/auth/login', { method: 'POST', body: { tenantName: 'Demo Fiber', accountNumber: 'DEMO-1001', credential: '+254700000001' } })).status, 401);
  let code;
  const challenge = await issuePortalChallenge({ tenant: data.tenants[0], customer: data.customers[0] }, { deliver: async (_tenant, _to, body) => { code = body.match(/\b\d{6}\b/)[0]; } });
  await assert.rejects(completePortalChallenge({ challengeId: challenge.challengeId, code: '000000', newPin: '123456' }));
  await completePortalChallenge({ challengeId: challenge.challengeId, code, newPin: '123456' });
  await assert.rejects(completePortalChallenge({ challengeId: challenge.challengeId, code, newPin: '999999' }));
  assert.equal((await request('/portal-api/auth/verify', { token: tokens.portal })).status, 401);
  const customer = await Customer.findById(data.customers[0]._id).lean();
  assert.equal(customer.portalProfile.sessionVersion, 1);
});

test('settlement is atomic, concurrent replay is harmless, and access failure remains recoverable', async (t) => {
  const Payment = require('../models/Payment');
  const Invoice = require('../models/Invoice');
  const Allocation = require('../models/InvoiceAllocation');
  const Ledger = require('../models/BillingLedgerEntry');
  const Outbox = require('../models/AccessOutbox');
  const { financialTransaction } = require('../services/financialTransaction');
  const { syncPaymentFinancials, reversePaymentStatus } = require('../services/billingFinanceService');
  const { processAccessOutbox } = require('../services/accessOutboxService');
  const paymentId = data.payments[0]._id;
  const apply = () => financialTransaction(async () => {
    const payment = await Payment.findById(paymentId);
    payment.status = 'Success'; await payment.save();
    return syncPaymentFinancials({ paymentId });
  });
  const original = Ledger.insertMany;
  const failure = t.mock.method(Ledger, 'insertMany', async function(rows, options) {
    if (rows[0]?.sourceType === 'payment') throw new Error('Injected ledger outage');
    return original.call(this, rows, options);
  });
  await assert.rejects(apply(), /Injected ledger outage/);
  failure.mock.restore();
  assert.equal((await Payment.findById(paymentId)).status, 'Pending');
  assert.equal(await Allocation.countDocuments({ payment: paymentId }), 0);
  assert.equal(await Outbox.countDocuments(), 0);
  await Promise.all([apply(), apply(), apply()]);
  const settled = await Payment.findById(paymentId);
  assert.equal(settled.allocatedAmount, 2500, JSON.stringify({ payment: settled.toObject(), invoice: await Invoice.findById(data.invoices[0]._id).lean(), allocations: await Allocation.find({payment:paymentId}).lean() }));
  assert.equal(await Allocation.countDocuments({ payment: paymentId, status: 'applied' }), 1);
  assert.equal((await Invoice.findById(data.invoices[0]._id)).balanceDue, 0);
  const before = await Ledger.countDocuments();
  await syncPaymentFinancials({ paymentId });
  assert.equal(await Ledger.countDocuments(), before);
  const failed = await processAccessOutbox({ sync: async () => { throw new Error('Router offline'); } });
  assert.equal(failed.retried, 1);
  assert.equal((await Payment.findById(paymentId)).isFinanciallyApplied, true);
  const recovered = await processAccessOutbox({ now: new Date(Date.now() + 60000), sync: async () => ({ active: true }) });
  assert.equal(recovered.completed, 1);
  await reversePaymentStatus({ tenantId: data.tenants[0]._id, paymentId, nextStatus: 'Refunded' });
  const ledgerCount = await Ledger.countDocuments();
  await reversePaymentStatus({ tenantId: data.tenants[0]._id, paymentId, nextStatus: 'Refunded' });
  assert.equal(await Ledger.countDocuments(), ledgerCount);
  assert.equal((await Invoice.findById(data.invoices[0]._id)).balanceDue, 2500);
});

test('stored secrets rotate with both keys present and decrypt after retiring the old key', async () => {
  const crypto = require('node:crypto');
  const Config = require('../models/PaymentConfig');
  const { decryptField, reencryptField } = require('../security/fieldEncryption');
  const oldKey = process.env.DATA_ENCRYPTION_KEY;
  const config = await Config.create({ ispId: data.tenants[0]._id, provider: 'stripe', secretKey: 'demo-provider-secret' });
  const raw = await Config.collection.findOne({ _id: config._id });
  assert.ok(raw.secretKey.startsWith('enc:v1:primary:'));
  const next = crypto.randomBytes(32).toString('base64');
  process.env.DATA_ENCRYPTION_KEYS = JSON.stringify({ primary: oldKey, next });
  process.env.DATA_ENCRYPTION_ACTIVE_KEY_ID = 'next';
  const rotated = reencryptField(raw.secretKey);
  await Config.collection.updateOne({ _id: config._id }, { $set: { secretKey: rotated } });
  process.env.DATA_ENCRYPTION_KEYS = JSON.stringify({ next });
  assert.equal(decryptField((await Config.collection.findOne({ _id: config._id })).secretKey), 'demo-provider-secret');
  delete process.env.DATA_ENCRYPTION_KEYS; delete process.env.DATA_ENCRYPTION_ACTIVE_KEY_ID;
});

test('Stripe signatures preserve raw bytes; concurrent callbacks settle once and forged duplicates cannot poison an event', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fixture_only';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_local_fixture_only';
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const Events = require('../models/PaymentGatewayEvent');
  const Payment = require('../models/Payment');
  const Allocation = require('../models/InvoiceAllocation');
  const payment = data.payments[1];
  const payload = JSON.stringify({ id: 'evt_local_signed', type: 'payment_intent.succeeded', data: { object: {
    id: payment.transactionId, amount_received: 250000, currency: 'kes', metadata: { paymentId: String(payment._id) },
  } } });
  const send = (signature) => fetch(base + '/api/payment/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, body: payload });
  assert.equal((await send('invalid')).status, 400);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const responses = await Promise.all([send(signature), send(signature), send(signature)]);
  for (const res of responses) assert.equal(res.status, 200, await res.text());
  assert.equal((await Payment.findById(payment._id)).isFinanciallyApplied, true);
  assert.equal(await Allocation.countDocuments({ payment: payment._id, status: 'applied' }), 1);
  assert.equal((await Events.findOne({ dedupeKey: 'stripe:webhook:evt_local_signed' })).eventStatus, 'processed');
  assert.equal((await send('invalid')).status, 400);
  assert.equal((await Events.findOne({ dedupeKey: 'stripe:webhook:evt_local_signed' })).eventStatus, 'processed');
});

test('terminal websocket checks each role and revokes a connected session before executing a command', async () => {
  const { io } = require('socket.io-client');
  const Membership = require('../models/Membership');
  async function connect(token, ispId) {
    const socket = io(base + '/terminal', { auth: { token, ispId }, transports: ['websocket'], reconnection: false, timeout: 5000 });
    return new Promise(resolve => { socket.once('connect', () => resolve({ socket })); socket.once('connect_error', error => { socket.disconnect(); resolve({ error }); }); });
  }
  for (const token of [tokens.portal, tokens.platform, tokens.operator]) assert.ok((await connect(token)).error);
  assert.ok((await connect(tokens.owner, String(data.tenants[1]._id))).error);
  for (const role of ['owner', 'admin']) {
    const result = await connect(tokens[role]); assert.ok(result.socket);
    if (role === 'admin') { result.socket.disconnect(); continue; }
    await Membership.deleteOne({ user: data.users.owner._id, tenant: data.tenants[0]._id });
    const message = new Promise(resolve => result.socket.once('error', resolve));
    result.socket.emit('exec', { command: '/system/resource/print' });
    assert.match(await message, /revoked|expired/i); result.socket.disconnect();
    assert.equal((await request('/api/customers', { token: tokens.owner })).status, 403);
  }
});
