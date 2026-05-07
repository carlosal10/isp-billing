'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseIntegrationLimit,
  serializeIntegrationCustomer,
  serializeIntegrationInvoice,
  serializeIntegrationPayment,
} = require('../services/integrationApiService');

test('parseIntegrationLimit defaults invalid values and clamps large values', () => {
  assert.equal(parseIntegrationLimit(undefined), 100);
  assert.equal(parseIntegrationLimit('0'), 100);
  assert.equal(parseIntegrationLimit('12.9'), 12);
  assert.equal(parseIntegrationLimit('900'), 500);
});

test('serializeIntegrationCustomer exposes service context but redacts sensitive portal and processor data', () => {
  const serialized = serializeIntegrationCustomer({
    _id: 'customer-1',
    name: 'Ada ISP',
    email: 'ada@example.test',
    phone: '+254700000000',
    accountNumber: 'ACC-001',
    connectionType: 'static',
    staticConfig: { ip: '10.10.10.2', gateway: '10.10.10.1' },
    plan: { _id: 'plan-1', name: 'Fiber 20M', price: 2000 },
    billingProfile: {
      autopayEnabled: true,
      preferredPaymentMethod: 'mpesa',
      preferredPhoneNumber: '+254711111111',
      stripeCustomerId: 'cus_secret',
      stripePaymentMethodId: 'pm_secret',
    },
    portalProfile: {
      isEnabled: true,
      pinHash: 'hash-secret',
    },
  });

  assert.equal(serialized.id, 'customer-1');
  assert.equal(serialized.service.static.ip, '10.10.10.2');
  assert.equal(serialized.billingProfile.autopayEnabled, true);
  assert.equal(Object.hasOwn(serialized, 'portalProfile'), false);
  assert.equal(Object.hasOwn(serialized.billingProfile, 'preferredPhoneNumber'), false);
  assert.equal(Object.hasOwn(serialized.billingProfile, 'stripeCustomerId'), false);
  assert.equal(Object.hasOwn(serialized.billingProfile, 'stripePaymentMethodId'), false);
});

test('serializeIntegrationInvoice returns finance status without internal metadata', () => {
  const serialized = serializeIntegrationInvoice({
    _id: 'invoice-1',
    invoiceNumber: 'INV-001',
    status: 'partially_paid',
    total: 2500,
    amountPaid: 1000,
    balanceDue: 1500,
    customer: { _id: 'customer-1', name: 'Ada ISP', accountNumber: 'ACC-001' },
    plan: { _id: 'plan-1', name: 'Fiber 20M' },
    lineItems: [
      { description: 'Monthly service', kind: 'service', quantity: 1, unitPrice: 2500, amount: 2500, metadata: { internal: true } },
    ],
    metadata: { internal: true },
  });

  assert.equal(serialized.customer.accountNumber, 'ACC-001');
  assert.equal(serialized.total, 2500);
  assert.equal(serialized.lineItems[0].amount, 2500);
  assert.equal(Object.hasOwn(serialized, 'metadata'), false);
  assert.equal(Object.hasOwn(serialized.lineItems[0], 'metadata'), false);
});

test('serializeIntegrationPayment omits mutable admin audit internals', () => {
  const serialized = serializeIntegrationPayment({
    _id: 'payment-1',
    amount: 1000,
    method: 'mpesa',
    status: 'Success',
    transactionId: 'TX-1',
    accountNumber: 'ACC-001',
    customer: { _id: 'customer-1', name: 'Ada ISP', accountNumber: 'ACC-001' },
    invoice: { _id: 'invoice-1', invoiceNumber: 'INV-001', status: 'paid', total: 1000, balanceDue: 0 },
    editLog: [{ by: 'admin@example.test' }],
    notes: 'internal note',
    deletedBy: 'admin@example.test',
  });

  assert.equal(serialized.invoice.invoiceNumber, 'INV-001');
  assert.equal(serialized.transactionId, 'TX-1');
  assert.equal(Object.hasOwn(serialized, 'editLog'), false);
  assert.equal(Object.hasOwn(serialized, 'notes'), false);
  assert.equal(Object.hasOwn(serialized, 'deletedBy'), false);
});
