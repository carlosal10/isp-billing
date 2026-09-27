'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-with-at-least-32-characters';
process.env.JWT_ISSUER = process.env.JWT_ISSUER || 'swiftbridge-test-api';

const assert = require('assert');
const test = require('node:test');

const { readBearerToken } = require('../middleware/bearerToken');
const requireAuth = require('../middleware/requireAuth');
const {
  createRequirePlatformAdmin,
} = require('../middleware/requirePlatformAdmin');
const requirePortalAuth = require('../middleware/requirePortalAuth');
const {
  createRequireTenant,
  resolveTenantContext,
} = require('../middleware/requireTenant');
const {
  authenticateTenantSocket,
  readSocketToken,
} = require('../security/tenantSocketAuth');
const {
  ACCESS_TOKEN_AUDIENCES,
  ACCESS_TOKEN_ISSUER,
  signCustomerPortalAccessToken,
  signPlatformAccessToken,
  signTenantAccessToken,
  verifyCustomerPortalAccessToken,
  verifyPlatformAccessToken,
  verifyTenantAccessToken,
} = require('../utils/jwt');

function responseDouble() {
  return {
    body: null,
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    sendStatus(code) {
      this.statusCode = code;
      return this;
    },
  };
}

function realmTokens() {
  const tenant = { _id: 'tenant-a', name: 'Tenant A' };
  const user = { _id: 'user-a', email: 'staff@example.test' };
  const admin = { _id: 'admin-a', email: 'admin@example.test', username: 'admin', isSuper: true };
  const customer = { _id: 'customer-a', accountNumber: 'ACC-1', name: 'Customer A' };
  return {
    portal: signCustomerPortalAccessToken({ tenant, customer }),
    platform: signPlatformAccessToken({ admin }),
    tenant: signTenantAccessToken({ user, tenantId: tenant._id }),
  };
}

test('access tokens carry a strict issuer, use, and distinct audience', () => {
  const tokens = realmTokens();
  const tenantClaims = verifyTenantAccessToken(tokens.tenant);
  const platformClaims = verifyPlatformAccessToken(tokens.platform);
  const portalClaims = verifyCustomerPortalAccessToken(tokens.portal);

  assert.equal(tenantClaims.aud, ACCESS_TOKEN_AUDIENCES.TENANT_STAFF);
  assert.equal(platformClaims.aud, ACCESS_TOKEN_AUDIENCES.PLATFORM_ADMIN);
  assert.equal(portalClaims.aud, ACCESS_TOKEN_AUDIENCES.CUSTOMER_PORTAL);
  assert.equal(tenantClaims.iss, ACCESS_TOKEN_ISSUER);
  assert.equal(tenantClaims.tokenUse, 'access');

  assert.throws(() => verifyTenantAccessToken(tokens.platform));
  assert.throws(() => verifyTenantAccessToken(tokens.portal));
  assert.throws(() => verifyPlatformAccessToken(tokens.tenant));
  assert.throws(() => verifyCustomerPortalAccessToken(tokens.tenant));
});

test('bearer parsing rejects ambiguous and non-bearer authorization values', () => {
  assert.equal(readBearerToken({ headers: { authorization: 'Bearer token-value' } }), 'token-value');
  assert.equal(readBearerToken({ headers: { authorization: 'bearer token-value' } }), 'token-value');
  assert.equal(readBearerToken({ headers: { authorization: 'Basic token-value' } }), null);
  assert.equal(readBearerToken({ headers: { authorization: 'Bearer one two' } }), null);
  assert.equal(readBearerToken({ headers: {} }), null);
});

test('HTTP realm middleware rejects tokens issued for another realm', () => {
  const tokens = realmTokens();
  const requirePlatformAdmin = createRequirePlatformAdmin({
    adminLookup: async () => ({ isActive: true, isSuper: true, sessionVersion: 0 }),
  });

  const tenantResponse = responseDouble();
  let tenantNext = false;
  requireAuth(
    { method: 'GET', headers: { authorization: `Bearer ${tokens.platform}` } },
    tenantResponse,
    () => { tenantNext = true; }
  );
  assert.equal(tenantNext, false);
  assert.equal(tenantResponse.statusCode, 401);

  const platformResponse = responseDouble();
  requirePlatformAdmin(
    { headers: { authorization: `Bearer ${tokens.tenant}` } },
    platformResponse,
    () => assert.fail('tenant token must not enter platform realm')
  );
  assert.equal(platformResponse.statusCode, 401);

  const portalResponse = responseDouble();
  requirePortalAuth(
    { method: 'GET', headers: { authorization: `Bearer ${tokens.tenant}` } },
    portalResponse,
    () => assert.fail('tenant token must not enter portal realm')
  );
  assert.equal(portalResponse.statusCode, 401);
});

test('platform middleware checks current admin state and session generation', async () => {
  const tokens = realmTokens();
  const request = {
    headers: { authorization: `Bearer ${tokens.platform}` },
  };
  const response = responseDouble();
  const active = createRequirePlatformAdmin({
    adminLookup: async () => ({ isActive: true, isSuper: true, sessionVersion: 0 }),
  });
  let nextCalled = false;
  await active(request, response, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(request.user.isSuper, true);

  const revokedResponse = responseDouble();
  const revoked = createRequirePlatformAdmin({
    adminLookup: async () => ({ isActive: true, isSuper: true, sessionVersion: 0, revokedAt: new Date() }),
  });
  await revoked({ headers: { authorization: `Bearer ${tokens.platform}` } }, revokedResponse, () => {
    assert.fail('revoked platform session must not continue');
  });
  assert.equal(revokedResponse.statusCode, 401);

  const staleResponse = responseDouble();
  const stale = createRequirePlatformAdmin({
    adminLookup: async () => ({ isActive: true, isSuper: true, sessionVersion: 1 }),
  });
  await stale({ headers: { authorization: `Bearer ${tokens.platform}` } }, staleResponse, () => {
    assert.fail('stale platform session must not continue');
  });
  assert.equal(staleResponse.statusCode, 401);

  const disabledResponse = responseDouble();
  const disabled = createRequirePlatformAdmin({
    adminLookup: async () => ({ isActive: false, isSuper: true, sessionVersion: 0 }),
  });
  await disabled({ headers: { authorization: `Bearer ${tokens.platform}` } }, disabledResponse, () => {
    assert.fail('disabled platform admin must not continue');
  });
  assert.equal(disabledResponse.statusCode, 401);
});

test('tenant middleware derives tenant only from token and rejects header switching', () => {
  const baseRequest = {
    authRealm: 'tenant-staff',
    headers: {},
    user: { aud: 'tenant-staff', sub: 'user-a', ispId: 'tenant-a' },
  };

  assert.deepEqual(resolveTenantContext(baseRequest), { tenantId: 'tenant-a' });
  assert.deepEqual(
    resolveTenantContext({ ...baseRequest, headers: { 'x-isp-id': 'tenant-a' } }),
    { tenantId: 'tenant-a' }
  );

  const mismatch = resolveTenantContext({
    ...baseRequest,
    headers: { 'x-isp-id': 'tenant-b' },
  });
  assert.equal(mismatch.status, 403);
  assert.match(mismatch.error, /does not match/i);
});

test('tenant middleware requires a current membership and exposes its role', async () => {
  const lookups = [];
  const middleware = createRequireTenant({
    membershipLookup: async (userId, tenantId) => {
      lookups.push({ userId, tenantId });
      return { role: 'operator' };
    },
  });
  const request = {
    authRealm: 'tenant-staff',
    headers: { 'x-isp-id': 'tenant-a' },
    user: { aud: 'tenant-staff', sub: 'user-a', ispId: 'tenant-a' },
  };
  const response = responseDouble();
  let nextCalled = false;

  await middleware(request, response, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.deepEqual(lookups, [{ userId: 'user-a', tenantId: 'tenant-a' }]);
  assert.equal(request.tenantId, 'tenant-a');
  assert.equal(request.role, 'operator');
  assert.deepEqual(request.membership, { role: 'operator' });

  const denied = createRequireTenant({ membershipLookup: async () => null });
  const deniedResponse = responseDouble();
  await denied({ ...request, membership: undefined }, deniedResponse, () => assert.fail('membership is required'));
  assert.equal(deniedResponse.statusCode, 403);
});

test('terminal socket auth binds the connection to the token tenant and membership', async () => {
  const { tenant, platform } = realmTokens();
  assert.equal(readSocketToken(`Bearer ${tenant}`), tenant);
  assert.equal(readSocketToken(tenant), tenant);
  assert.equal(readSocketToken('Basic token'), null);

  const context = await authenticateTenantSocket(
    { token: tenant, ispId: 'tenant-a' },
    { membershipLookup: async () => ({ role: 'admin' }) }
  );
  assert.equal(context.tenantId, 'tenant-a');
  assert.equal(context.role, 'admin');

  await assert.rejects(
    authenticateTenantSocket(
      { token: tenant, ispId: 'tenant-b' },
      { membershipLookup: async () => ({ role: 'admin' }) }
    ),
    /does not match/i
  );
  await assert.rejects(
    authenticateTenantSocket(
      { token: platform, ispId: 'tenant-a' },
      { membershipLookup: async () => ({ role: 'admin' }) }
    )
  );
  await assert.rejects(
    authenticateTenantSocket(
      { token: tenant, ispId: 'tenant-a' },
      { membershipLookup: async () => null }
    ),
    /membership/i
  );
});
