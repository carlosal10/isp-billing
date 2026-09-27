'use strict';

const crypto = require('crypto');
const ApiKey = require('../models/ApiKey');

function hashKey(k) {
  return crypto.createHash('sha256').update(String(k)).digest('hex');
}

async function findApiKey(raw, now = new Date()) {
  const keyHash = hashKey(raw);
  return ApiKey.findOne({
    keyHash,
    active: true,
    $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }],
  }).lean();
}

// Auth via x-api-key; sets req.apiKey and req.tenantId if valid (no JWT required).
// Query-string credentials are deliberately unsupported because URLs are copied
// into access logs, browser history, proxies, and monitoring systems.
function createApiKeyAuth({ lookup = findApiKey, touch = null } = {}) {
  return async function apiKeyAuth(req, res, next) {
    try {
      const raw = req.headers['x-api-key'] || '';
      if (!raw) return res.status(401).json({ ok: false, error: 'Missing API key' });
      const key = await lookup(String(raw));
      if (!key) return res.status(401).json({ ok: false, error: 'Invalid API key' });
      req.apiKey = key;
      if (!req.tenantId) req.tenantId = String(key.tenantId);
      // Update lastUsedAt asynchronously; a failed telemetry write must not
      // turn a valid integration request into a failure.
      const touchPromise = touch
        ? touch(key)
        : ApiKey.updateOne({ _id: key._id }, { $set: { lastUsedAt: new Date() } });
      Promise.resolve(touchPromise).catch(() => {});
      return next();
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'API key auth failed' });
    }
  };
}

const apiKeyAuth = createApiKeyAuth();

function hasApiKeyScope(apiKey, scope) {
  if (!apiKey || !scope) return false;
  const scopes = Array.isArray(apiKey.scopes) ? apiKey.scopes : [];
  return scopes.includes(scope);
}

function requireApiKeyScope(...requiredScopes) {
  return (req, res, next) => {
    const key = req.apiKey;
    if (!key) return res.status(401).json({ ok: false, error: 'Missing API key context' });
    const ok = requiredScopes.some((scope) => hasApiKeyScope(key, scope));
    if (!ok) {
      return res.status(403).json({ ok: false, error: 'API key scope denied' });
    }
    return next();
  };
}

module.exports = {
  apiKeyAuth,
  createApiKeyAuth,
  findApiKey,
  hashKey,
  hasApiKeyScope,
  requireApiKeyScope,
};
