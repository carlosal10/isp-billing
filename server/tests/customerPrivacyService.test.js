'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  anonymizedAccountNumber,
  buildAnonymizationConfirmation,
  buildAnonymizedCustomerPatch,
  normalizePrivacyMode,
  parseLimit,
  serializeCustomerSubject,
} = require('../services/customerPrivacyService');

test('normalizePrivacyMode defaults to masked unless full is explicitly requested', () => {
  assert.equal(normalizePrivacyMode('full'), 'full');
  assert.equal(normalizePrivacyMode('FULL'), 'full');
  assert.equal(normalizePrivacyMode('masked'), 'masked');
  assert.equal(normalizePrivacyMode(undefined), 'masked');
});

test('parseLimit clamps customer privacy export limits', () => {
  assert.equal(parseLimit(undefined), 500);
  assert.equal(parseLimit('-1'), 500);
  assert.equal(parseLimit('42.9'), 42);
  assert.equal(parseLimit('9999'), 2000);
});

test('serializeCustomerSubject masks PII and never exposes portal pin hashes', () => {
  const serialized = serializeCustomerSubject(
    {
      _id: '64f000000000000000000123',
      tenantId: 'tenant-1',
      name: 'Ada Customer',
      email: 'ada@example.com',
      phone: '+254700000000',
      address: 'Fiber Street',
      accountNumber: 'ACC-001-XYZ',
      accountAliases: ['OLD-ACC-001'],
      billingProfile: {
        preferredPhoneNumber: '+254711222333',
        stripeCustomerId: 'cus_123456789',
        stripePaymentMethodId: 'pm_123456789',
      },
      portalProfile: {
        isEnabled: true,
        pinHash: '$2b$12$secret',
        lastLoginMethod: 'pin',
      },
    },
    { privacyMode: 'masked' }
  );

  assert.equal(serialized.email, 'a***@example.com');
  assert.equal(serialized.phone, '+254******000');
  assert.equal(serialized.address, '[anonymized]');
  assert.equal(serialized.accountNumber, 'ACC******YZ');
  assert.equal(serialized.billingProfile.preferredPhoneNumber, '+254******333');
  assert.equal(serialized.portalProfile.hasPin, true);
  assert.equal(Object.hasOwn(serialized.portalProfile, 'pinHash'), false);
});

test('buildAnonymizedCustomerPatch removes direct identifiers and disables contact paths', () => {
  const now = new Date('2026-05-16T08:00:00.000Z');
  const customer = {
    _id: '64f000000000000000000123',
    accountNumber: 'ACC-001',
    phone: '+254700000000',
    billingProfile: {
      invoiceLeadDays: 5,
      autopayEnabled: true,
      preferredPhoneNumber: '+254700000000',
      stripeCustomerId: 'cus_secret',
      stripePaymentMethodId: 'pm_secret',
    },
    portalProfile: {
      pinHash: '$2b$12$secret',
      lastLoginAt: now,
    },
  };

  const patch = buildAnonymizedCustomerPatch({
    customer,
    actor: { email: 'owner@example.com' },
    reason: 'customer request',
    now,
  });

  assert.equal(anonymizedAccountNumber(customer._id), 'ANON-0000000123');
  assert.equal(buildAnonymizationConfirmation(customer), 'ANONYMIZE-ACC-001');
  assert.equal(patch.email, null);
  assert.equal(patch.phone, null);
  assert.equal(patch.address, null);
  assert.equal(patch.accountNumber, 'ANON-0000000123');
  assert.deepEqual(patch.accountAliases, []);
  assert.equal(patch.billingProfile.autopayEnabled, false);
  assert.equal(patch.billingProfile.preferredPhoneNumber, null);
  assert.equal(patch.billingProfile.stripeCustomerId, null);
  assert.equal(patch.billingProfile.maxAutopayAttempts, 0);
  assert.equal(patch.portalProfile.isEnabled, false);
  assert.equal(patch.portalProfile.pinHash, null);
  assert.equal(patch.communicationPreferences.transactionalSmsEnabled, false);
  assert.equal(patch.privacyProfile.isAnonymized, true);
  assert.equal(patch.privacyProfile.anonymizedBy, 'owner@example.com');
});
