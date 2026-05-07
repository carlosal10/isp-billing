'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  matchesCustomerCredential,
  normalizePortalAccountNumber,
  normalizePortalTenantLookup,
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
