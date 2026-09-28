'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  matchesCustomerCredential,
  normalizePortalAccountNumber,
  normalizePortalTenantLookup,
  resolvePortalLoginMethod,
} = require('../services/customerPortalIdentity');

test('normalizePortalTenantLookup lowercases and trims lookup values', () => {
  assert.equal(normalizePortalTenantLookup('  Acme Fiber '), 'acme fiber');
});

test('normalizePortalAccountNumber uppercases and trims account numbers', () => {
  assert.equal(normalizePortalAccountNumber(' ab-123 '), 'AB-123');
});

test('matchesCustomerCredential supports email and Kenyan phone normalization', () => {
  const customer = {
    email: 'customer@example.com',
    phone: '0712345678',
  };

  assert.equal(matchesCustomerCredential(customer, 'customer@example.com'), true);
  assert.equal(matchesCustomerCredential(customer, '+254712345678'), true);
  assert.equal(matchesCustomerCredential(customer, '0712345678'), true);
  assert.equal(matchesCustomerCredential(customer, 'wrong@example.com'), false);
});

test('configured portal PIN cannot be bypassed with a matching contact value', async () => {
  let pinComparisonAttempted = false;
  const customer = {
    email: 'customer@example.com',
    portalProfile: { pinHash: 'stored-pin-hash' },
  };

  const method = await resolvePortalLoginMethod(
    customer,
    { credential: 'customer@example.com', pin: '0000' },
    {
      comparePin: async () => {
        pinComparisonAttempted = true;
        return false;
      },
    }
  );

  assert.equal(method, null);
  assert.equal(pinComparisonAttempted, true);
});

test('portal login requires a PIN and never accepts contact bootstrap', async () => {
  const withPin = {
    email: 'customer@example.com',
    portalProfile: { pinHash: 'stored-pin-hash' },
  };
  const withoutPin = { email: 'customer@example.com', portalProfile: {} };

  assert.equal(
    await resolvePortalLoginMethod(
      withPin,
      { credential: 'customer@example.com', pin: '1234' },
      { comparePin: async (pin, hash) => pin === '1234' && hash === 'stored-pin-hash' }
    ),
    'pin'
  );
  assert.equal(
    await resolvePortalLoginMethod(withoutPin, { credential: 'customer@example.com' }),
    null
  );
});
