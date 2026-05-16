'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  maybeMaskPhone,
  normalizeDeliveryStatus,
  parseLimit,
  redactContext,
  serializeMessageDelivery,
  truncate,
} = require('../services/messageDeliveryService');

test('normalizeDeliveryStatus maps provider vocabulary into platform states', () => {
  assert.equal(normalizeDeliveryStatus('Success'), 'delivered');
  assert.equal(normalizeDeliveryStatus('accepted'), 'sent');
  assert.equal(normalizeDeliveryStatus('error'), 'failed');
  assert.equal(normalizeDeliveryStatus('disabled'), 'skipped');
  assert.equal(normalizeDeliveryStatus('unknown'), 'queued');
});

test('message delivery limit parsing defaults invalid values and clamps unsafe values', () => {
  assert.equal(parseLimit(undefined), 100);
  assert.equal(parseLimit('-1'), 100);
  assert.equal(parseLimit('42.8'), 42);
  assert.equal(parseLimit('900'), 500);
});

test('redactContext removes secret-bearing fields recursively', () => {
  const redacted = redactContext({
    requestId: 'req-1',
    apiKey: 'secret',
    nested: {
      authToken: 'token',
      safe: 'value',
    },
  });

  assert.equal(redacted.requestId, 'req-1');
  assert.equal(redacted.apiKey, '[REDACTED]');
  assert.equal(redacted.nested.authToken, '[REDACTED]');
  assert.equal(redacted.nested.safe, 'value');
});

test('serializeMessageDelivery exposes only a body preview and safe context', () => {
  const serialized = serializeMessageDelivery({
    _id: 'delivery-1',
    channel: 'sms',
    provider: 'textsms',
    status: 'sent',
    to: '+254700000000',
    bodyPreview: truncate('Hello customer, this is a short message'),
    bodyLength: 39,
    providerMessageId: 'msg-1',
    customer: { _id: 'customer-1', name: 'Ada ISP', accountNumber: 'ACC-001' },
    context: { token: 'secret', batchId: 'batch-1' },
  });

  assert.equal(serialized.id, 'delivery-1');
  assert.equal(serialized.customer.accountNumber, 'ACC-001');
  assert.equal(serialized.context.token, '[REDACTED]');
  assert.equal(Object.hasOwn(serialized, 'body'), false);
});

test('serializeMessageDelivery can mask phone numbers for privacy-safe views', () => {
  const serialized = serializeMessageDelivery(
    {
      _id: 'delivery-1',
      to: '+254700000000',
      normalizedTo: '+254700000000',
      customer: { _id: 'customer-1', name: 'Ada ISP', phone: '+254711222333' },
      context: {},
    },
    { privacyMode: 'masked' }
  );

  assert.equal(maybeMaskPhone('+254700000000', { privacyMode: 'masked' }), '+254******000');
  assert.equal(serialized.to, '+254******000');
  assert.equal(serialized.normalizedTo, '+254******000');
  assert.equal(serialized.customer.phone, '+254******333');
});
