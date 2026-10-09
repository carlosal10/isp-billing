const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fakeNetworkRouter } = require('../testing/fakeNetworkRouter');
const { createHotspotProvisioner } = require('../services/hotspotProvisioningService');
const { createStaticProvisioner } = require('../services/staticProvisioningService');
const { parseAssignment } = require('../services/networkAssignmentInput');
const a = { _id: 'test', tenantId: 'tenant', routerId: 'router', desiredState: 'present', username: 'test-user', hotspotProfile: 'basic', ipAddress: '192.168.10.2', fup: { desired: 'normal' } };
test('hotspot creation, retry, suspension and release affect only owned subscriber', async () => {
  const f = fakeNetworkRouter({ '/ip/hotspot/user/profile': [{ name: 'basic' }], '/ip/hotspot/active': [{ '.id': 's1', user: 'test-user' }, { '.id': 's2', user: 'other' }], '/ip/hotspot/cookie': [{ '.id': 'c1', user: 'test-user' }] });
  const apply = createHotspotProvisioner(f.send);
  assert.equal((await apply(a, 'secret-test')).state, 'present');
  await apply(a, 'secret-test');
  assert.equal(f.writes.filter(w => w.path === '/ip/hotspot/user/add').length, 1);
  assert.equal((await apply({ ...a, desiredState: 'suspended' })).state, 'suspended');
  assert.equal(f.tables['/ip/hotspot/active'].length, 1);
  assert.equal(f.tables['/ip/hotspot/active'][0].user, 'other');
  assert.equal(f.tables['/ip/hotspot/cookie'].length, 0);
  assert.equal((await apply({ ...a, desiredState: 'absent' })).state, 'absent');
  assert.equal((await apply({ ...a, desiredState: 'absent' })).state, 'absent');
});
test('hotspot refuses existing unmanaged username without mutation', async () => {
  const f = fakeNetworkRouter({ '/ip/hotspot/user': [{ '.id': 'u1', name: a.username }] });
  await assert.rejects(createHotspotProvisioner(f.send)(a, 'secret-test'), /belongs/);
  assert.equal(f.writes.length, 0);
});
test('static suspension blocks both directions and only flushes matching flows; resume preserves FUP', async () => {
  const f = fakeNetworkRouter({ '/ip/firewall/filter': [{ '.id': 'fup1', comment: 'billing-fup-test-src' }], '/ip/firewall/connection': [{ '.id': 'c1', 'src-address': '192.168.10.2:555' }, { '.id': 'c2', 'src-address': '192.168.10.3:555' }] });
  const apply = createStaticProvisioner(f.send);
  await apply(a);
  assert.equal((await apply({ ...a, desiredState: 'suspended' })).state, 'suspended');
  assert.equal(f.tables['/ip/firewall/filter'].filter(r => r.action === 'drop').length, 2);
  assert.equal(f.tables['/ip/firewall/connection'].length, 1);
  await apply(a);
  assert.equal(f.tables['/ip/firewall/filter'].length, 1);
  assert.equal(f.tables['/ip/firewall/filter'][0].comment, 'billing-fup-test-src');
  assert.equal((await apply({ ...a, desiredState: 'absent' })).state, 'absent');
  assert.equal(f.tables['/queue/simple'].length, 0);
  assert.equal(f.tables['/ip/firewall/filter'].length, 0);
});
test('static queue ownership and invalid subnet targets fail without changes', async () => {
  const f = fakeNetworkRouter({ '/queue/simple': [{ name: 'billing-test', target: '192.168.10.99/32', comment: 'Billing assignment test' }] });
  await assert.rejects(createStaticProvisioner(f.send)(a), /differs/);
  await assert.rejects(createStaticProvisioner(f.send)({ ...a, ipAddress: '192.168.10.0/24' }), /single IPv4/);
  assert.equal(f.writes.length, 0);
});
test('assignment validation rejects missing hotspot login, radius shortcut and invalid IP', () => {
  const base = { customerId: 'a'.repeat(24), routerId: 'b'.repeat(24) };
  for (const input of [{ ...base, accessType: 'hotspot' }, { ...base, accessType: 'pppoe', authenticationMode: 'radius' }, { ...base, accessType: 'static', ipAddress: '10.0.0.0/24' }]) assert.throws(() => parseAssignment(input));
  assert.equal(parseAssignment({ ...base, accessType: 'hotspot', username: ' test ', password: 'test-pass', hotspotProfile: 'basic' }).username, 'test');
});
