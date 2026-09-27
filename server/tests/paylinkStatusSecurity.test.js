'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-with-at-least-32-characters';

const assert = require('node:assert/strict');
const test = require('node:test');

const { signPayToken } = require('../utils/paylink');
const { buildPaylinkStatusFilter } = require('../routes/paylink');

test('paylink status requires a valid paylink token and scopes payment lookup', () => {
  const token = signPayToken({
    tenantId: 'tenant-a',
    customerId: 'customer-a',
    planId: 'plan-a',
  });

  assert.deepEqual(
    buildPaylinkStatusFilter({ paymentId: 'payment-a', token }),
    { _id: 'payment-a', tenantId: 'tenant-a', customer: 'customer-a' }
  );

  assert.throws(
    () => buildPaylinkStatusFilter({ paymentId: 'payment-a' }),
    /token is required/i
  );
  assert.throws(
    () => buildPaylinkStatusFilter({ paymentId: 'payment-a', token: 'invalid' }),
    (error) => error.statusCode === 401
  );
});

test('paylink status source does not expose provider transaction ids', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'routes', 'paylink.js'), 'utf8');
  const statusBlock = source.slice(source.indexOf("router.get('/status'"));

  assert.doesNotMatch(statusBlock, /transactionId:\s*p\.transactionId/);
});
