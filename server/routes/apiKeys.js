const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const ApiKey = require('../models/ApiKey');
const { hashKey } = require('../middleware/apiKey');

// List keys for tenant
router.get('/', async (req, res) => {
  const rows = await ApiKey.find({ tenantId: req.tenantId }).sort({ createdAt: -1 }).lean();
  res.json(rows.map(r => ({ id: String(r._id), label: r.label, active: r.active, scopes: r.scopes, lastUsedAt: r.lastUsedAt, createdAt: r.createdAt })));
});

// Create key (returns plaintext once)
router.post('/', async (req, res) => {
  try {
    const label = String(req.body?.label || '').trim() || 'API Key';
    const scopes = Array.isArray(req.body?.scopes) ? req.body.scopes.map(String) : [];
    const raw = 'sk_' + crypto.randomBytes(24).toString('base64url');
    const keyHash = hashKey(raw);
    const doc = await ApiKey.create({ tenantId: req.tenantId, label, keyHash, scopes, active: true });
    res.status(201).json({ id: String(doc._id), key: raw });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create key' });
  }
});

// Revoke key
router.delete('/:id', async (req, res) => {
  await ApiKey.updateOne({ _id: req.params.id, tenantId: req.tenantId }, { $set: { active: false } });
  res.json({ ok: true });
});

module.exports = router;

