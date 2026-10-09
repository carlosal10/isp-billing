'use strict';
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { configureTestEnvironment, createTestDatabase } = require('../testing/environment');
configureTestEnvironment();
const mongoose = require('mongoose'), express = require('express');
const A = require('../models/NetworkAssignment'), O = require('../models/NetworkOperation');
const Customer = require('../models/customers'), Router = require('../models/MikrotikConnection');
const { processNetworkOperations } = require('../services/networkOperationService');
const { fakeNetworkRouter } = require('../testing/fakeNetworkRouter');
const { decryptField } = require('../security/fieldEncryption');
const oid = () => new mongoose.Types.ObjectId();
let db, server, url, routerPort = 18000;
const tenant = oid(), other = oid();
before(async () => {
  db = await createTestDatabase(); await mongoose.connect(process.env.MONGO_URI);
  for (const model of Object.values(mongoose.models)) await model.init();
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.tenantId = String(req.headers['x-test-tenant'] || tenant); req.user = { sub: String(oid()) }; req.membership = { role: req.headers['x-test-role'] || 'owner' }; next(); });
  app.use('/assignments', require('../routes/networkAssignments'));
  app.use('/routers', require('../routes/mikrotikServers'));
  app.use('/legacy-pppoe', require('../routes/mikrotikUser'));
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  url = 'http://127.0.0.1:' + server.address().port;
}, { timeout: 180000 });
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); if (db) await db.stop(); });
async function request(path, method = 'GET', body, headers = {}) {
  const response = await fetch(url + '/assignments' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
async function input(type = 'pppoe') {
  const customer = await Customer.create({ tenantId: tenant, accountNumber: String(oid()), name: 'Test', expiryDate: new Date(Date.now() + 86400000), connectionType: type === 'static' ? 'static' : 'pppoe' });
  const router = await Router.create({ tenant, name: String(oid()), host: '192.0.2.1', port: routerPort++, username: 'test', password: 'test-only' });
  return { customerId: String(customer._id), routerId: String(router._id), accessType: type, ...(type === 'static' ? { ipAddress: '192.0.2.30' } : { username: 'sub-' + oid(), password: 'subscriber-test-only', [type === 'pppoe' ? 'pppProfile' : 'hotspotProfile']: 'basic' }) };
}
async function drain(send) { return processNetworkOperations({ send, limit: 50, now: new Date(Date.now() + 600000) }); }
test('HTTP creation, worker verification, suspension and release keep requested and confirmed states separate', async () => {
  const payload = await input();
  const created = await request('', 'POST', payload); assert.equal(created.status, 201);
  const id = created.body.assignment._id;
  assert.equal(created.body.assignment.provisioningPassword, undefined);
  const stored = await A.findById(id).select('+provisioningPassword');
  assert.notEqual(stored.provisioningPassword, payload.password); assert.equal(decryptField(stored.provisioningPassword), payload.password);
  const fake = fakeNetworkRouter({ '/ppp/profile': [{ name: 'basic' }] });
  assert.equal((await drain(fake.send)).completed, 1);
  assert.equal((await A.findById(id)).observedState, 'present');
  assert.equal((await request('/' + id, 'PATCH', { desiredState: 'suspended' })).status, 200);
  await drain(fake.send); assert.equal((await A.findById(id)).observedState, 'suspended');
  const release = await request('/' + id, 'DELETE');
  assert.equal(release.body.assignment.status, 'provisioning');
  assert.equal(release.body.assignment.observedState, 'suspended');
  await drain(fake.send); assert.equal((await A.findById(id)).status, 'released');
  assert.equal(fake.tables['/ppp/secret'].length, 0);
});
test('assignment and operation roll back together on queue failure', async () => {
  const payload = await input(); const original = O.create;
  try {
    O.create = async () => { throw new Error('Simulated queue failure'); };
    assert.equal((await request('', 'POST', payload)).status, 500);
  } finally { O.create = original; }
  assert.equal(await A.countDocuments({ customerId: payload.customerId }), 0);
});
test('tenant isolation, operator denial, invalid filters, and bounded pagination', async () => {
  const payload = await input('hotspot'); const created = await request('', 'POST', payload);
  assert.equal(created.status, 201);
  assert.equal((await request('/' + created.body.assignment._id, 'DELETE', null, { 'x-test-tenant': String(other) })).status, 404);
  assert.equal((await request('', 'POST', payload, { 'x-test-role': 'operator' })).status, 403);
  assert.equal((await request('?routerId=invalid')).status, 400);
  assert.equal((await request('?limit=-1')).status, 400);
  const list = await request('?limit=1'); assert.equal(list.body.items.length, 1); assert.ok(list.body.nextCursor);
  assert.ok(!JSON.stringify(list.body).includes('provisioningPassword'));
  await drain(fakeNetworkRouter({ '/ip/hotspot/user/profile': [{ name: 'basic' }] }).send);
});
test('concurrent duplicate creation reserves one username and one operation', async () => {
  const payload = await input();
  const customer = await Customer.create({ tenantId: tenant, accountNumber: String(oid()), connectionType: 'pppoe' });
  const results = await Promise.all([request('', 'POST', payload), request('', 'POST', { ...payload, customerId: String(customer._id) })]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  const assignment = await A.findOne({ routerId: payload.routerId });
  assert.equal(await O.countDocuments({ assignmentId: assignment._id }), 1);
  await drain(fakeNetworkRouter({ '/ppp/profile': [{ name: 'basic' }] }).send);
});
test('worker defers when FUP holds assignment lease and fences changes mid-flight', async () => {
  const payload = await input('static'); const created = await request('', 'POST', payload); const id = created.body.assignment._id;
  await A.updateOne({ _id: id }, { $set: { 'fup.leaseToken': 'another-worker', 'fup.leaseUntil': new Date(Date.now() + 120000) } });
  let calls = 0;
  await drain(async () => { calls++; return []; }); assert.equal(calls, 0);
  await A.updateOne({ _id: id }, { $unset: { 'fup.leaseToken': 1, 'fup.leaseUntil': 1 } });
  const fake = fakeNetworkRouter();
  await processNetworkOperations({ limit: 1, now: new Date(Date.now() + 600000), send: async (...args) => { if (!calls++) await A.updateOne({ _id: id }, { $set: { desiredState: 'suspended' } }); return fake.send(...args); } });
  assert.equal(fake.writes.length, 0);
  assert.notEqual((await A.findById(id)).observedState, 'present');
  await drain(fake.send); assert.equal((await A.findById(id)).observedState, 'suspended');
});
test('router deletion cannot orphan a concurrently created assignment', async () => {
  const payload = await input();
  const [created, deleted] = await Promise.all([
    request('', 'POST', payload),
    fetch(url + '/routers/' + payload.routerId, { method: 'DELETE' }),
  ]);
  assert.ok((created.status === 201 && deleted.status === 409) || (created.status === 404 && deleted.status === 200));
  if (created.status === 201) { assert.ok(await Router.exists({ _id: payload.routerId })); await drain(fakeNetworkRouter({ '/ppp/profile': [{ name: 'basic' }] }).send); }
  else assert.equal(await A.countDocuments({ routerId: payload.routerId }), 0);
});
test('customer creation and contact/account edits perform no router writes; archival preserves identity', async () => {
  const { createCustomer, updateCustomer, deleteCustomer } = require('../services/customerWriteService');
  const plan = await require('../models/plan').create({ tenantId: tenant, name: String(oid()), description: 'test', duration: '30 days', speed: 10, rateLimit: '10M/10M', price: 100 });
  const manager = require('../utils/mikrotikConnectionManager'), original = manager.sendCommand;
  manager.sendCommand = async () => { throw new Error('Customer CRUD must not touch router'); };
  try {
    await assert.rejects(createCustomer({ tenantId: tenant, payload: { plan: plan._id, connectionType: 'pppoe', pppoeConfig: { profile: 'basic' } } }), { statusCode: 409 });
    const c = await createCustomer({ tenantId: tenant, payload: { name: 'Billing only', accountNumber: String(oid()), connectionType: 'pppoe', plan: plan._id } });
    assert.equal(c.networkWorkflowVersion, 2); assert.equal(c.pppoeConfig?.profile, undefined);
    const edited = await updateCustomer({ tenantId: tenant, customerId: c._id, payload: { name: 'Updated', accountNumber: 'NEW-' + oid() } });
    assert.equal(edited.name, 'Updated');
    await deleteCustomer({ tenantId: tenant, customerId: c._id });
    assert.equal((await Customer.findById(c._id)).status, 'archived');
    const { syncCustomerAccessFromPayments } = require('../services/customerAccessService');
    assert.equal((await syncCustomerAccessFromPayments({ tenantId: tenant, customerId: c._id })).archived, true);
    assert.equal((await Customer.findById(c._id)).status, 'archived');
  } finally { manager.sendCommand = original; }
});
test('billing resume preserves manual suspension and billing suspension survives manual resume', async () => {
  const payload = await input(); const created = await request('', 'POST', payload), id = created.body.assignment._id;
  const { synchronizeBilling } = require('../services/subscriberAccessService');
  const c = await Customer.findById(payload.customerId);
  await request('/' + id, 'PATCH', { desiredState: 'suspended' });
  await synchronizeBilling(c, false); await synchronizeBilling(c, true);
  let a = await A.findById(id); assert.equal(a.desiredState, 'suspended'); assert.equal(a.manualState, 'suspended');
  await synchronizeBilling(c, false);
  await request('/' + id, 'PATCH', { desiredState: 'present' });
  a = await A.findById(id); assert.equal(a.desiredState, 'suspended'); assert.equal(a.manualState, 'present');
  await synchronizeBilling(c, true); a = await A.findById(id); assert.equal(a.desiredState, 'present');
  const count = await O.countDocuments({ assignmentId: id });
  await synchronizeBilling(c, true); assert.equal(await O.countDocuments({ assignmentId: id }), count);
  await drain(fakeNetworkRouter({ '/ppp/profile': [{ name: 'basic' }] }).send);
});
test('new service without entitlement is provisioned suspended and cannot bypass billing', async () => {
  const payload = await input(); await Customer.updateOne({ _id: payload.customerId }, { $unset: { expiryDate: 1 } });
  const created = await request('', 'POST', payload), id = created.body.assignment._id;
  assert.equal(created.body.assignment.billingState, 'blocked'); assert.equal(created.body.assignment.desiredState, 'suspended');
  await request('/' + id, 'PATCH', { desiredState: 'present' });
  const fake = fakeNetworkRouter({ '/ppp/profile': [{ name: 'basic' }] }); await drain(fake.send);
  assert.equal((await A.findById(id)).observedState, 'suspended');
  assert.equal(fake.tables['/ppp/secret'][0].disabled, 'yes');
});
test('existing account linking adopts exactly one account without resetting credentials; rotation is durable', async () => {
  const payload = await input();
  const fake = fakeNetworkRouter({ '/ppp/secret': [{ '.id': '*legacy', name: payload.username, password: 'original-test', profile: 'basic', service: 'pppoe', comment: 'Customer: Test', disabled: 'no' }] });
  const manager = require('../utils/mikrotikConnectionManager'), original = manager.sendCommand;
  manager.sendCommand = fake.send;
  try {
    const discovery = await request('/discover/pppoe?routerId=' + payload.routerId);
    assert.equal(discovery.status, 200); assert.ok(!JSON.stringify(discovery.body).includes('original-test'));
    const body = { customerId: payload.customerId, routerId: payload.routerId, username: payload.username };
    const result = await request('/link', 'POST', body); assert.equal(result.status, 201);
    const id = result.body.assignment._id;
    assert.equal((await request('/link', 'POST', body)).status, 409);
    await drain(fake.send); assert.equal(fake.tables['/ppp/secret'].length, 1);
    assert.equal(fake.tables['/ppp/secret'][0].password, 'original-test');
    assert.equal(fake.tables['/ppp/secret'][0].comment, 'billing-assignment:' + id);
    const rotation = await request('/' + id + '/password', 'POST', { password: 'rotated-test-pass' }); assert.equal(rotation.status, 200);
    await drain(fake.send); assert.equal(fake.tables['/ppp/secret'][0].password, 'rotated-test-pass');
    const a = await A.findById(id).select('+provisioningPassword');
    assert.equal(decryptField(a.provisioningPassword), 'rotated-test-pass'); assert.equal(a.appliedCredentialVersion, a.credentialVersion);
    const { getCustomerHealth } = require('../services/customerNetworkReadService');
    assert.equal((await getCustomerHealth(tenant, (await Customer.findById(payload.customerId)).accountNumber)).services[0].username, payload.username);
    await request('/' + id, 'DELETE'); await drain(fake.send); assert.equal(fake.tables['/ppp/secret'].length, 0);
    await require('../services/customerWriteService').deleteCustomer({ tenantId: tenant, customerId: payload.customerId });
    assert.equal((await Customer.findById(payload.customerId)).status, 'archived');
  } finally { manager.sendCommand = original; }
});
test('link preview and mutations enforce tenant and role boundaries; direct writes are retired', async () => {
  const payload = await input();
  assert.equal((await request('/discover/pppoe?routerId=' + payload.routerId, 'GET', null, { 'x-test-tenant': String(other) })).status, 404);
  assert.equal((await request('/link', 'POST', { ...payload }, { 'x-test-role': 'operator' })).status, 403);
  const response = await fetch(url + '/legacy-pppoe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  assert.equal(response.status, 409);
});
test('archival and service creation serialize; customer edits never overwrite ownership', async () => {
  const { deleteCustomer, updateCustomer } = require('../services/customerWriteService');
  const payload = await input(); await Customer.updateOne({ _id: payload.customerId }, { $set: { networkWorkflowVersion: 2 } });
  const [created, archived] = await Promise.all([request('', 'POST', payload), deleteCustomer({ tenantId: tenant, customerId: payload.customerId }).then(() => true).catch(e => e.statusCode)]);
  assert.ok((created.status === 201 && archived === 409) || (created.status === 404 && archived === true));
  if (created.status === 201) {
    await assert.rejects(updateCustomer({ tenantId: tenant, customerId: payload.customerId, payload: { pppoeConfig: { profile: 'other' } } }), { statusCode: 409 });
    await drain(fakeNetworkRouter({ '/ppp/profile': [{ name: 'basic' }] }).send);
  }
});
test('release queued before linking completes still verifies ownership and removal', async () => {
  const payload = await input();
  const fake = fakeNetworkRouter({ '/ppp/secret': [{ '.id': '*pending', name: payload.username, profile: 'basic', service: 'pppoe', comment: 'legacy' }] });
  const manager = require('../utils/mikrotikConnectionManager'), original = manager.sendCommand; manager.sendCommand = fake.send;
  try {
    const linked = await request('/link', 'POST', { customerId: payload.customerId, routerId: payload.routerId, username: payload.username });
    assert.equal(linked.status, 201);
    await request('/' + linked.body.assignment._id, 'DELETE'); await drain(fake.send);
    assert.equal((await A.findById(linked.body.assignment._id)).status, 'released');
    assert.equal(fake.tables['/ppp/secret'].length, 0);
  } finally { manager.sendCommand = original; }
});
