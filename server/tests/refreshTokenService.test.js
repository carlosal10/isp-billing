'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  consumeRefreshToken,
  hashRefreshToken,
  issueRefreshToken,
  refreshExpiry,
  revokeRefreshToken,
} = require('../services/refreshTokenService');

test('refresh expiry uses the configured day window from a fixed clock', () => {
  const now = new Date('2026-09-27T00:00:00.000Z');
  assert.equal(refreshExpiry(7, now).toISOString(), '2026-10-04T00:00:00.000Z');
  assert.equal(refreshExpiry(0, now).toISOString(), '2026-10-27T00:00:00.000Z');
});

test('issuing a refresh token stores a one-way digest and returns the raw value once', async () => {
  let created = null;
  const now = new Date('2026-09-27T00:00:00.000Z');
  const model = {
    async create(value) {
      created = value;
      return value;
    },
  };

  const token = await issueRefreshToken(
    { userId: 'user-a', tenantId: 'tenant-a' },
    { model, now, tokenFactory: () => 'deterministic-refresh-token' }
  );

  assert.equal(token, 'deterministic-refresh-token');
  assert.deepEqual(created, {
    token: hashRefreshToken(token),
    user: 'user-a',
    tenant: 'tenant-a',
    expiresAt: new Date('2026-10-27T00:00:00.000Z'),
    isRevoked: false,
  });
});

test('refresh token consumption is an atomic single-use revocation', async () => {
  const now = new Date('2026-09-27T00:00:00.000Z');
  const current = { _id: 'refresh-a', user: 'user-a', tenant: 'tenant-a' };
  let consumed = false;
  const calls = [];
  const model = {
    async findOneAndUpdate(filter, update, options) {
      calls.push({ filter, update, options });
      if (consumed) return null;
      consumed = true;
      return current;
    },
  };

  const [first, replay] = await Promise.all([
    consumeRefreshToken('refresh-token', { model, now }),
    consumeRefreshToken('refresh-token', { model, now }),
  ]);

  assert.equal(first, current);
  assert.equal(replay, null);
  assert.deepEqual(calls[0], {
    filter: {
      token: { $in: [hashRefreshToken('refresh-token'), 'refresh-token'] },
      isRevoked: { $ne: true },
      expiresAt: { $gt: now },
    },
    update: { $set: { isRevoked: true, revokedAt: now } },
    options: { new: false },
  });
});

test('logout revokes an active refresh token and records when it happened', async () => {
  const now = new Date('2026-09-27T00:00:00.000Z');
  let call = null;
  const model = {
    async updateMany(filter, update) {
      call = { filter, update };
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    },
  };

  await revokeRefreshToken('refresh-token', { model, now });
  assert.deepEqual(call, {
    filter: {
      token: { $in: [hashRefreshToken('refresh-token'), 'refresh-token'] },
      isRevoked: { $ne: true },
    },
    update: { $set: { isRevoked: true, revokedAt: now } },
  });
});
