'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const events = require('../services/paymentGatewayEventService');
// Unit tests isolate query policy; real transactions are covered by integration/readiness.test.js.
require('../services/financialTransaction').transactional = (work) => work;
require('../models/PaymentGatewayEvent').findOneAndUpdate = async () => ({ _id: 'unit-event' });
const correlation = require('../services/paymentGatewayCorrelationService');
// Replace network/DB side effects before loading the processor. Model queries
// below are asserted so an unscoped fallback fails the regression tests.
events.finalizeGatewayEvent = async (_id, patch) => patch;
correlation.findStkCorrelation = async () => null;
correlation.markStkCorrelationCallback = async () => null;
const Payment = require('../models/Payment');
const PaymentConfig = require('../models/PaymentConfig');
const Legacy = require('../models/MpesaSettings');
const Customer = require('../models/customers');
const { processGatewayEvent } = require('../services/paymentGatewayProcessingService');

test('uncorrelated public STK callback cannot search payments by phone and amount', async (t) => {
  t.mock.method(Payment, 'find', () => assert.fail('No global payment search is allowed'));
  t.mock.method(Payment, 'findOne', () => assert.fail('No unscoped payment lookup is allowed'));
  const result = await processGatewayEvent({
    _id: 'event-a', provider: 'mpesa', kind: 'stk-callback',
    payload: { Body: { stkCallback: {
      ResultCode: 0,
      CallbackMetadata: { Item: [
        { Name: 'PhoneNumber', Value: '254712345678' },
        { Name: 'Amount', Value: 1000 },
      ] },
    } } },
  });
  assert.equal(result.eventStatus, 'unmatched');
});

test('C2B confirmation never searches another tenant when the account is missing', async (t) => {
  t.mock.method(Legacy, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  t.mock.method(PaymentConfig, 'find', () => ({ limit: () => ({ lean: async () => [{ ispId: 'tenant-a' }] }) }));
  let lookups = 0;
  t.mock.method(Customer, 'findOne', async (filter) => {
    lookups += 1;
    assert.equal(filter.tenantId, 'tenant-a');
    assert.deepEqual(filter.$or, [{ accountNumber: 'SHARED-1' }, { accountAliases: 'SHARED-1' }]);
    return null;
  });
  t.mock.method(Payment, 'findOne', () => assert.fail('No payment mutation before a scoped customer match'));
  const result = await processGatewayEvent({
    _id: 'event-b', provider: 'mpesa', kind: 'c2b-confirmation',
    payload: { BusinessShortCode: '123456', BillRefNumber: 'SHARED-1', TransAmount: 1000, TransID: 'receipt' },
  });
  assert.equal(lookups, 1);
  assert.equal(result.eventStatus, 'unmatched');
  assert.equal(result.tenantId, 'tenant-a');
});

test('C2B confirmation rejects a shortcode with no tenant binding', async (t) => {
  t.mock.method(Legacy, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  t.mock.method(PaymentConfig, 'find', () => ({ limit: () => ({ lean: async () => [{ ispId: null }] }) }));
  t.mock.method(Customer, 'findOne', () => assert.fail('Unbound shortcode cannot look up customers'));
  const result = await processGatewayEvent({
    _id: 'event-c', provider: 'mpesa', kind: 'c2b-confirmation',
    payload: { BusinessShortCode: '123456', BillRefNumber: 'SHARED-1', TransAmount: 1000 },
  });
  assert.equal(result.eventStatus, 'rejected');
});
