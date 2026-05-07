'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_SCOPES,
  normalizeScopes,
  parseExpiry,
  serializeApiKey,
} = require('../services/apiKeyService');

test('normalizeScopes defaults to safe read scopes and rejects unsupported scopes', () => {
  assert.deepEqual(normalizeScopes([]), DEFAULT_SCOPES);
  assert.deepEqual(normalizeScopes(['payments:read', 'payments:read']), ['payments:read']);
  assert.throws(() => normalizeScopes(['root:*']), /Unsupported API key scope/);
});

test('parseExpiry accepts future dates and rejects past dates', () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  assert.equal(parseExpiry(null), null);
  assert.equal(parseExpiry(future).toISOString(), future);
  assert.throws(() => parseExpiry(new Date(Date.now() - 1000).toISOString()), /future/);
});

test('serializeApiKey never exposes keyHash and computes effective active state', () => {
  const serialized = serializeApiKey({
    _id: 'key-1',
    label: 'CRM',
    keyHash: 'secret',
    prefix: 'sk_live_x',
    active: true,
    scopes: ['customers:read'],
    expiresAt: new Date(Date.now() - 1000),
  });

  assert.equal(serialized.id, 'key-1');
  assert.equal(serialized.active, false);
  assert.equal(serialized.storedActive, true);
  assert.equal(serialized.isExpired, true);
  assert.equal(Object.hasOwn(serialized, 'keyHash'), false);
});
