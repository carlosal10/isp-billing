'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { serializeCustomerForAdmin } = require('../services/customerReadService');

test('serializeCustomerForAdmin leaves records unchanged unless masking is requested', () => {
  const customer = {
    name: 'Ada Customer',
    email: 'ada@example.com',
    phone: '+254700000000',
    accountNumber: 'ACC-001-XYZ',
  };

  assert.equal(serializeCustomerForAdmin(customer), customer);
});

test('serializeCustomerForAdmin masks direct identifiers for safe review views', () => {
  const masked = serializeCustomerForAdmin(
    {
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
    },
    { privacyMode: 'masked' }
  );

  assert.equal(masked.name, 'A**********r');
  assert.equal(masked.email, 'a***@example.com');
  assert.equal(masked.phone, '+254******000');
  assert.equal(masked.address, '[anonymized]');
  assert.equal(masked.accountNumber, 'ACC******YZ');
  assert.equal(masked.billingProfile.preferredPhoneNumber, '+254******333');
});
