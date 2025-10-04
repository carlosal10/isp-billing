'use strict';

const crypto = require('crypto');
const ApiKey = require('../models/ApiKey');

function hashKey(k) {
  return crypto.createHash('sha256').update(String(k)).digest('hex');
}

// Auth via x-api-key; sets req.apiKey and req.tenantId if valid (no JWT required)
async function apiKeyAuth(req, res, next) {
  try {
    const raw = req.headers['x-api-key'] || req.query.apiKey || '';
    if (!raw) return res.status(401).json({ ok: false, error: 'Missing API key' });
    const keyHash = hashKey(raw);
    const key = await ApiKey.findOne({ keyHash, active: true }).lean();
    if (!key) return res.status(401).json({ ok: false, error: 'Invalid API key' });
    req.apiKey = key;
    if (!req.tenantId) req.tenantId = String(key.tenantId);
    // update lastUsedAt asynchronously
    ApiKey.updateOne({ _id: key._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
    next();
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'API key auth failed' });
  }
}

module.exports = { apiKeyAuth, hashKey };

