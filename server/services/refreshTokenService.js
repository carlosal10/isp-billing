'use strict';

const crypto = require('crypto');
const RefreshToken = require('../models/RefreshToken');

function refreshExpiry(
  days = Number(process.env.REFRESH_TTL_DAYS || 30),
  now = new Date()
) {
  const ttlDays = Number.isFinite(Number(days)) && Number(days) > 0 ? Number(days) : 30;
  return new Date(now.getTime() + ttlDays * 86400 * 1000);
}

function createRefreshTokenValue() {
  return crypto.randomBytes(48).toString('base64url');
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function refreshTokenLookup(token) {
  const normalized = String(token || '').trim();
  if (!normalized) return null;
  // Raw lookup remains temporarily for refresh tokens issued before digest
  // storage was introduced. Every successful use revokes the legacy record.
  return { $in: [hashRefreshToken(normalized), normalized] };
}

async function issueRefreshToken(
  { userId, tenantId },
  {
    model = RefreshToken,
    now = new Date(),
    tokenFactory = createRefreshTokenValue,
  } = {}
) {
  if (!userId || !tenantId) {
    throw new Error('issueRefreshToken: userId and tenantId are required');
  }

  const token = String(tokenFactory() || '').trim();
  if (!token) throw new Error('issueRefreshToken: token factory returned an empty value');
  await model.create({
    token: hashRefreshToken(token),
    user: userId,
    tenant: tenantId,
    expiresAt: refreshExpiry(undefined, now),
    isRevoked: false,
  });
  return token;
}

async function consumeRefreshToken(
  token,
  { model = RefreshToken, now = new Date() } = {}
) {
  const normalized = String(token || '').trim();
  if (!normalized) return null;

  // The revocation predicate makes rotation single-use. Two concurrent requests
  // cannot both consume the same token and mint independent replacement chains.
  return model.findOneAndUpdate(
    {
      token: refreshTokenLookup(normalized),
      isRevoked: { $ne: true },
      expiresAt: { $gt: now },
    },
    {
      $set: {
        isRevoked: true,
        revokedAt: now,
      },
    },
    { new: false }
  );
}

async function revokeRefreshToken(token, { model = RefreshToken, now = new Date() } = {}) {
  const normalized = String(token || '').trim();
  if (!normalized) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
  return model.updateMany(
    { token: refreshTokenLookup(normalized), isRevoked: { $ne: true } },
    { $set: { isRevoked: true, revokedAt: now } }
  );
}

module.exports = {
  consumeRefreshToken,
  createRefreshTokenValue,
  hashRefreshToken,
  issueRefreshToken,
  refreshTokenLookup,
  refreshExpiry,
  revokeRefreshToken,
};
