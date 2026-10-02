'use strict';
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { configureTestEnvironment, createTestDatabase } = require('../testing/environment');
configureTestEnvironment();
const mongoose = require('mongoose');
const Customer = require('../models/customers');
const Plan = require('../models/plan');
const Payment = require('../models/Payment');
const Invoice = require('../models/Invoice');
const Credit = require('../models/CreditNote');
const Ledger = require('../models/BillingLedgerEntry');
const Allocation = require('../models/InvoiceAllocation');
const finance = require('../services/billingFinanceService');
const reconciliation = require('../services/providerReconciliationService');
let replica, data, sequence = 0;
before(async () => {
  replica = await createTestDatabase(); await mongoose.connect(process.env.MONGO_URI);
  data = await require('../testing/seed').seedTestData();
  for (const model of Object.values(mongoose.models)) await model.init();
}, { timeout: 180000 });
after(async () => { await mongoose.disconnect(); if (replica) await replica.stop(); });
async function fixture() {
  const tenantId = data.tenants[0]._id, plan = data.plans[0];
  const customer = await Customer.create({ tenantId, plan: plan._id, name: 'Billing test', accountNumber: `BILL-${++sequence}`, connectionType: 'pppoe' });
  const invoice = await finance.issueInvoiceForPlan({ tenantId, customerId: customer._id, planId: plan._id });
  return { tenantId, plan, customer, invoice };
}
async function pay(f, amount, extra = {}) {
  const payment = await Payment.create({ tenantId: f.tenantId, customer: f.customer._id, plan: f.plan._id, invoice: f.invoice._id,
    accountNumber: f.customer.accountNumber, amount, method: 'manual', status: 'Success', validatedAt: new Date(), ...extra });
  await finance.syncPaymentFinancials({ paymentId: payment._id });
  return Payment.findById(payment._id);
}
test('real invoice creation resolves IDs and populated documents, posts correct ledger, rejects foreign records', async () => {
  const f = await fixture();
  assert.equal(f.invoice.total, 2500); assert.equal(f.invoice.balanceDue, 2500);
  assert.equal(await Ledger.countDocuments({ invoice: f.invoice._id, sourceType: 'invoice' }), 2);
  const populated = await finance.issueInvoiceForPlan({ tenantId: f.tenantId, customerId: f.customer, planId: f.plan });
  assert.equal(populated.total, 2500);
  for (const planId of [data.plans[1], data.plans[1]._id, String(data.plans[1]._id)]) {
    await assert.rejects(finance.issueInvoiceForPlan({ tenantId: f.tenantId, customerId: f.customer, planId }), /not found/);
  }
  const invoice = new Invoice({ tenantId: f.tenantId, customer: f.customer._id, plan: f.plan._id, dueDate: new Date(),
    lineItems: [{ description: 'Rounded service', quantity: 3, unitPrice: 33.335 }], discountTotal: 10, taxTotal: 14.4 });
  await invoice.validate(); assert.equal(invoice.total, 104.41);
});
test('partial payment, overpayment credit, application and reversal preserve invoice and ledger balances', async () => {
  const f = await fixture(), first = await pay(f, 1000);
  assert.equal((await Invoice.findById(f.invoice._id)).balanceDue, 1500);
  const second = await pay(f, 2000);
  assert.equal(second.allocatedAmount, 1500); assert.equal(second.unappliedAmount, 500);
  const next = await finance.issueInvoiceForPlan({ tenantId: f.tenantId, customerId: f.customer._id, planId: f.plan._id });
  assert.equal(next.balanceDue, 2000);
  assert.equal((await Credit.findOne({ sourcePayment: second._id })).remainingAmount, 0);
  await finance.reversePaymentStatus({ tenantId: f.tenantId, paymentId: second._id, nextStatus: 'Refunded', reason: 'Provider refund confirmed' });
  assert.equal((await Invoice.findById(f.invoice._id)).balanceDue, 1500);
  assert.equal((await Invoice.findById(next._id)).balanceDue, 2500);
  assert.equal((await Payment.findById(first._id)).isFinanciallyApplied, true);
  const rows = await Ledger.find({ customer: f.customer._id });
  assert.equal(Math.round(rows.reduce((sum, r) => sum + (r.direction === 'debit' ? r.amount : -r.amount), 0) * 100), 0);
  const balance = account => rows.filter(r => r.account === account).reduce((sum, r) => sum + (r.direction === 'debit' ? r.amount : -r.amount), 0);
  assert.equal(balance('cash'), 1000, 'Only the first payment remains in cash');
  assert.equal(balance('accounts_receivable'), 4000, 'Both invoices reopen by the reversed amount');
  assert.equal(balance('customer_credits'), 0, 'Reversed credit must not remain on the ledger');
});
for (const nextStatus of ['Refunded', 'Reversed', 'Chargeback']) {
  test(`${nextStatus} is atomic and concurrent retries produce one reversal`, async t => {
    const f = await fixture(), payment = await pay(f, 2500);
    const original = Ledger.insertMany;
    const fault = t.mock.method(Ledger, 'insertMany', async () => { throw new Error('Injected reversal failure'); });
    await assert.rejects(finance.reversePaymentStatus({ tenantId: f.tenantId, paymentId: payment._id, nextStatus }), /Injected reversal failure/);
    fault.mock.restore();
    assert.equal(Ledger.insertMany, original);
    assert.equal((await Payment.findById(payment._id)).status, 'Success');
    assert.equal((await Invoice.findById(f.invoice._id)).balanceDue, 0);
    await Promise.all([1, 2, 3].map(() => finance.reversePaymentStatus({ tenantId: f.tenantId, paymentId: payment._id, nextStatus })));
    assert.equal((await Invoice.findById(f.invoice._id)).balanceDue, 2500);
    assert.equal(await Allocation.countDocuments({ payment: payment._id, status: 'applied' }), 0);
    const count = await Ledger.countDocuments({ payment: payment._id });
    await finance.reversePaymentStatus({ tenantId: f.tenantId, paymentId: payment._id, nextStatus });
    assert.equal(await Ledger.countDocuments({ payment: payment._id }), count);
    await assert.rejects(finance.reversePaymentStatus({ tenantId: f.tenantId, paymentId: payment._id, nextStatus: nextStatus === 'Refunded' ? 'Chargeback' : 'Refunded' }), /already reversed/);
  });
}
test('settlement rejects a foreign invoice and a currency mismatch without allocations', async () => {
  const f = await fixture();
  for (const extra of [{ invoice: data.invoices[1]._id }, { currency: 'USD' }]) {
    await assert.rejects(pay(f, 2500, extra), /does not belong/);
  }
  assert.equal(await Allocation.countDocuments({ customer: f.customer._id }), 0);
});

test('allocation, payment-save and access-queue failures roll back the entire settlement', async t => {
  const Outbox = require('../models/AccessOutbox');
  const { financialTransaction } = require('../services/financialTransaction');
  for (const stage of ['allocation', 'payment', 'access']) {
    const f = await fixture();
    const payment = await Payment.create({ tenantId: f.tenantId, customer: f.customer._id, plan: f.plan._id, invoice: f.invoice._id, accountNumber: f.customer.accountNumber, amount: 2500, method: 'manual' });
    const originalSave = Payment.prototype.save;
    const fault = stage === 'allocation' ? t.mock.method(Allocation, 'insertMany', async () => { throw new Error('Injected allocation failure'); }) :
      stage === 'access' ? t.mock.method(Outbox, 'findOneAndUpdate', async () => { throw new Error('Injected access failure'); }) :
      t.mock.method(Payment.prototype, 'save', async function (...args) { if (this.isFinanciallyApplied) throw new Error('Injected payment failure'); return originalSave.apply(this, args); });
    await assert.rejects(financialTransaction(async () => {
      const row = await Payment.findById(payment._id); row.status = 'Success'; await row.save();
      await finance.syncPaymentFinancials({ paymentId: payment._id });
    }), /Injected/);
    fault.mock.restore();
    assert.equal((await Payment.findById(payment._id)).status, 'Pending');
    assert.equal((await Invoice.findById(f.invoice._id)).balanceDue, 2500);
    assert.equal(await Allocation.countDocuments({ payment: payment._id }), 0);
    assert.equal(await Ledger.countDocuments({ payment: payment._id }), 0);
    assert.equal(await Outbox.countDocuments({ customerId: f.customer._id }), 0);
    payment.status = 'Success'; await payment.save(); await finance.syncPaymentFinancials({ paymentId: payment._id });
    assert.equal((await Invoice.findById(f.invoice._id)).balanceDue, 0);
  }
});
test('provider statements are tenant scoped, replayable, reconciled and auditable', async () => {
  const f = await fixture(); await pay(f, 2500, { method: 'stripe', transactionId: 'pi_statement_fixture' });
  const input = { tenantId: f.tenantId, actor: 'test-owner', provider: 'stripe', start: new Date(Date.now() - 60000), end: new Date(Date.now() + 60000),
    rows: [{ reference: 'pi_statement_fixture', amount: 2500, currency: 'KES', occurredAt: new Date() },
      { reference: 'pi_missing_fixture', amount: 100, currency: 'KES', occurredAt: new Date() }] };
  const statement = await reconciliation.importStatement(input);
  assert.equal(String((await reconciliation.importStatement(input))._id), String(statement._id));
  const report = await reconciliation.getStatementReport(f.tenantId, statement._id);
  assert.equal(report.rows.find(r => r.reference === 'pi_statement_fixture').status, 'matched');
  const missing = report.rows.find(r => r.reference === 'pi_missing_fixture'); assert.equal(missing.status, 'missing-payment');
  await reconciliation.acknowledgeDiscrepancy({ tenantId: f.tenantId, id: statement._id, key: missing.key, reason: 'Investigated duplicate provider export', actor: 'test-owner' });
  assert.ok((await reconciliation.getStatementReport(f.tenantId, statement._id)).rows.find(r => r.key === missing.key).acknowledgement);
  await assert.rejects(reconciliation.getStatementReport(data.tenants[1]._id, statement._id), /not found/);
});

test('M-Pesa settings migrate once, preserve encrypted secrets, and reject ambiguous shortcode ownership', async () => {
  const Legacy = require('../models/MpesaSettings'), Config = require('../models/PaymentConfig');
  const { getMpesaConfig, resolveMpesaShortcode } = require('../services/mpesaConfigurationService');
  await Legacy.create({ ispId: String(data.tenants[0]._id), businessName: 'Legacy ISP', paybillShortcode: '654321', consumerSecret: 'local-test-secret' });
  const config = await getMpesaConfig(data.tenants[0]._id);
  const raw = await Config.collection.findOne({ _id: config._id });
  assert.ok(raw.consumerSecret.startsWith('enc:'));
  assert.equal(String((await getMpesaConfig(data.tenants[0]._id))._id), String(config._id));
  assert.equal((await resolveMpesaShortcode('654321')).ispId, String(data.tenants[0]._id));
  await Config.create({ ispId: String(data.tenants[1]._id), provider: 'mpesa', paybillShortcode: '654321' });
  assert.equal(await resolveMpesaShortcode('654321'), null);
});
test('correlated M-Pesa callback settles once, quarantines amount mismatch and ignores late failure', async () => {
  const f = await fixture(), Events = require('../models/PaymentGatewayEvent');
  const { upsertStkCorrelation } = require('../services/paymentGatewayCorrelationService');
  const { processGatewayEvent } = require('../services/paymentGatewayProcessingService');
  const payment = await Payment.create({ tenantId: f.tenantId, customer: f.customer._id, plan: f.plan._id, invoice: f.invoice._id,
    accountNumber: f.customer.accountNumber, amount: 2500, method: 'mpesa', checkoutRequestId: 'checkout-fixture', phoneNumber: '254712345678' });
  await upsertStkCorrelation({ tenantId: f.tenantId, paymentId: payment._id, checkoutRequestId: 'checkout-fixture', amount: 2500 });
  async function event(key, amount, ResultCode = 0) {
    return Events.create({ provider: 'mpesa', kind: 'stk-callback', dedupeKey: key, payload: { Body: { stkCallback: {
      CheckoutRequestID: 'checkout-fixture', ResultCode, CallbackMetadata: { Item: [
        { Name: 'MpesaReceiptNumber', Value: 'MPESA-FIXTURE' }, { Name: 'Amount', Value: amount }, { Name: 'PhoneNumber', Value: '254712345678' },
      ] },
    } } } });
  }
  const mismatch = await event('mpesa-mismatch', 2499); await processGatewayEvent(mismatch);
  assert.equal((await Events.findById(mismatch._id)).eventStatus, 'rejected');
  assert.equal((await Payment.findById(payment._id)).status, 'Pending');
  const success = await event('mpesa-success', 2500);
  await Promise.all([1, 2, 3].map(() => processGatewayEvent(success)));
  assert.equal((await Invoice.findById(f.invoice._id)).balanceDue, 0);
  assert.equal(await Allocation.countDocuments({ payment: payment._id, status: 'applied' }), 1);
  await processGatewayEvent(await event('mpesa-late-failure', 2500, 1032));
  assert.equal((await Payment.findById(payment._id)).status, 'Success');
});

test('C2B receipt survives a failed first attempt and duplicate event IDs without double posting', async t => {
  const f = await fixture(), Config = require('../models/PaymentConfig'), Events = require('../models/PaymentGatewayEvent');
  const { processGatewayEvent } = require('../services/paymentGatewayProcessingService');
  await Config.findOneAndUpdate({ ispId: String(f.tenantId), provider: 'mpesa' }, { $set: { paybillShortcode: '765432' } }, { upsert: true });
  const payload = { TransID: 'C2B-REPLAY-FIXTURE', TransAmount: '2500', BusinessShortCode: '765432', BillRefNumber: f.customer.accountNumber, TransTime: '20260928093000', MSISDN: '254712345678' };
  const first = await Events.create({ provider: 'mpesa', kind: 'c2b-confirmation', dedupeKey: 'c2b-first', payload });
  const insert = Ledger.insertMany;
  const failure = t.mock.method(Ledger, 'insertMany', async function(rows, options) { if (rows[0]?.sourceType === 'payment') throw new Error('C2B ledger unavailable'); return insert.call(this, rows, options); });
  await assert.rejects(processGatewayEvent(first), /C2B ledger unavailable/);
  failure.mock.restore();
  assert.equal(await Payment.countDocuments({ transactionId: payload.TransID }), 0);
  await processGatewayEvent(first);
  const payment = await Payment.findOne({ transactionId: payload.TransID });
  assert.equal(payment.isFinanciallyApplied, true);
  const before = await Ledger.countDocuments({ payment: payment._id });
  const duplicate = await Events.create({ provider: 'mpesa', kind: 'c2b-confirmation', dedupeKey: 'c2b-duplicate', payload });
  await processGatewayEvent(duplicate);
  assert.equal(await Ledger.countDocuments({ payment: payment._id }), before);
  assert.equal((await Invoice.findById(f.invoice._id)).balanceDue, 0);
});
