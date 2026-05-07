'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizePortalAccessPayload,
  serializePortalProfile,
  validatePortalPin,
} = require('../services/customerPortalAdminService');

test('validatePortalPin accepts 4 to 8 digit PINs only', () => {
  assert.equal(validatePortalPin('1234'), '1234');
  assert.equal(validatePortalPin('00123456'), '00123456');
  assert.throws(() => validatePortalPin('123'), /4 to 8 digits/);
  assert.throws(() => validatePortalPin('123456789'), /4 to 8 digits/);
  assert.throws(() => validatePortalPin('12ab'), /4 to 8 digits/);
});

test('normalizePortalAccessPayload rejects conflicting PIN operations', () => {
  assert.throws(
    () => normalizePortalAccessPayload({ pin: '1234', clearPin: true }),
    /Choose either pin or clearPin/
  );
});

test('serializePortalProfile returns safe status without exposing hash material', () => {
  const serialized = serializePortalProfile({
    _id: 'cust-1',
    accountNumber: 'AC-100',
    name: 'Ada Customer',
    portalProfile: {
      isEnabled: false,
      pinHash: '$2b$12$secret',
      lastLoginAt: new Date('2026-04-28T08:00:00.000Z'),
      lastLoginMethod: 'pin',
    },
  });

  assert.equal(serialized.customerId, 'cust-1');
  assert.equal(serialized.portalProfile.isEnabled, false);
  assert.equal(serialized.portalProfile.hasPin, true);
  assert.equal(Object.hasOwn(serialized.portalProfile, 'pinHash'), false);
});
