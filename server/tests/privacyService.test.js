'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  maskAccountNumber,
  maskEmail,
  maskIpAddress,
  maskPhone,
  maskTransactionId,
  redactObject,
} = require('../services/privacyService');

test('redactObject removes common secret-bearing fields without mutating safe values', () => {
  const input = {
    requestId: 'req-1',
    accessToken: 'token',
    nested: {
      consumerSecret: 'secret',
      accountNumber: 'ACC-001',
    },
  };

  const redacted = redactObject(input);

  assert.equal(redacted.requestId, 'req-1');
  assert.equal(redacted.accessToken, '[redacted]');
  assert.equal(redacted.nested.consumerSecret, '[redacted]');
  assert.equal(redacted.nested.accountNumber, 'ACC-001');
  assert.equal(input.accessToken, 'token');
});

test('redactObject respects depth and array safety limits', () => {
  const redacted = redactObject(
    {
      items: [{ safe: 'one' }, { safe: 'two' }],
      nested: { level1: { level2: { safe: 'too-deep' } } },
    },
    { maxArrayLength: 1, maxDepth: 2, maxDepthLabel: '[too-deep]' }
  );

  assert.equal(redacted.items.length, 1);
  assert.equal(redacted.nested.level1.level2, '[too-deep]');
});

test('masking helpers produce deterministic review-safe values', () => {
  assert.equal(maskEmail('ada@example.com'), 'a***@example.com');
  assert.equal(maskPhone('+254700000000'), '+254******000');
  assert.equal(maskAccountNumber('ACC-001-XYZ'), 'ACC******YZ');
  assert.equal(maskTransactionId('TXN-1234567890'), 'TXN-******7890');
  assert.equal(maskIpAddress('192.168.10.42'), '192.168.10.0/24');
});
