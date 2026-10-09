const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPppoeService } = require('../services/pppoeService');
const input = { username: 'test-subscriber', password: 'test-password-only', profile: 'test-profile', assignmentId: 'assignment-1', enabled: false };
function fixture(existing = [], profiles = [{ name: 'test-profile' }]) {
  let rows = existing; const writes = [];
  const service = createPppoeService(async (path, words) => {
    if (path === '/ppp/secret/print') return rows;
    if (path === '/ppp/profile/print') return profiles;
    writes.push({ path, words });
    if (path === '/ppp/secret/add') rows = [{ '.id': '*1', name: input.username, comment: 'billing-assignment:assignment-1', service: 'pppoe', profile: input.profile, disabled: true }];
    return [];
  });
  return { service, writes };
}
test('provisioning creates a disabled account with profile and ownership and returns no password', async () => {
  const { service, writes } = fixture();
  const result = await service.ensureProvisioned({}, input);
  assert.equal(writes.length, 1);
  assert.ok(writes[0].words.includes('=disabled=yes'));
  assert.ok(writes[0].words.includes('=comment=billing-assignment:assignment-1'));
  assert.equal(result.disabled, true);
  assert.equal(result.password, undefined);
  await service.ensureProvisioned({}, input);
  assert.equal(writes.length, 1, 'retry must not create a duplicate');
});
test('existing unmanaged account is never adopted or modified', async () => {
  const { service, writes } = fixture([{ '.id': '*2', name: input.username, service: 'pppoe' }]);
  await assert.rejects(service.ensureProvisioned({}, input), { statusCode: 409 });
  assert.equal(writes.length, 0);
});
test('unknown profile prevents any router mutation', async () => {
  const { service, writes } = fixture([], []);
  await assert.rejects(service.ensureProvisioned({}, input), { statusCode: 400 });
  assert.equal(writes.length, 0);
});
test('reconciliation preserves an owned account with an FUP profile', async () => {
  const { service, writes } = fixture([{ '.id': '*1', name: input.username, comment: 'billing-assignment:assignment-1', service: 'pppoe', profile: 'billing-fup-test' }]);
  const result = await service.ensureProvisioned({}, input);
  assert.equal(result.profile, 'billing-fup-test');
  assert.equal(writes.length, 0);
});
test('release refuses an account with changed ownership', async () => {
  const { service, writes } = fixture([{ '.id': '*1', name: input.username, service: 'pppoe', comment: 'someone-else' }]);
  await assert.rejects(service.remove({}, input.username, input.assignmentId), { statusCode: 409 });
  assert.equal(writes.length, 0);
});
test('release retries succeed when the managed account is already absent', async () => {
  const { service, writes } = fixture();
  await service.remove({}, input.username, input.assignmentId);
  assert.equal(writes.length, 0);
});
test('provisioning credential is excluded from assignment JSON and normal queries', () => {
  const Assignment = require('../models/NetworkAssignment');
  const assignment = new Assignment({ provisioningPassword: 'encrypted-test' });
  assert.equal(assignment.toJSON().provisioningPassword, undefined);
  assert.equal(Assignment.schema.path('provisioningPassword').options.select, false);
});
test('linking verifies its snapshot and never recreates a missing existing account', async () => {
  const { fakeNetworkRouter } = require('../testing/fakeNetworkRouter');
  const assignment = { _id: 'link-1', username: 'legacy', linkedAccount: { routerId: '*legacy', originalComment: 'Customer: Test' } };
  const fake = fakeNetworkRouter({ '/ppp/secret': [{ '.id': '*legacy', name: 'legacy', service: 'pppoe', comment: 'changed' }] });
  const service = createPppoeService(fake.send);
  await assert.rejects(service.ensureLinked({}, assignment), { statusCode: 409 }); assert.equal(fake.writes.length, 0);
  fake.tables['/ppp/secret'] = [];
  await assert.rejects(service.ensureLinked({}, assignment), { statusCode: 404 }); assert.equal(fake.writes.length, 0);
});
