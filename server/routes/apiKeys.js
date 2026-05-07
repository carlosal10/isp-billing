const express = require('express');
const router = express.Router();
const requireRole = require('../middleware/requireRole');
const {
  createApiKey,
  listApiKeyScopes,
  listApiKeys,
  revokeApiKey,
  updateApiKey,
} = require('../services/apiKeyService');

function requestActor(req) {
  return {
    id: String(req.user?.email || req.user?.sub || req.user?.id || req.user?._id || ''),
    userId: String(req.user?.sub || req.user?.id || req.user?._id || ''),
    email: req.user?.email || null,
    role: req.role || (req.user?.isPlatformAdmin ? 'platform-admin' : null),
  };
}

router.use(requireRole('owner', 'admin'));

router.get('/scopes', (_req, res) => {
  res.json(listApiKeyScopes());
});

// List keys for tenant
router.get('/', async (req, res) => {
  try {
    const rows = await listApiKeys(req.tenantId);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load API keys' });
  }
});

// Create key (returns plaintext once)
router.post('/', async (req, res) => {
  try {
    const result = await createApiKey({
      tenantId: req.tenantId,
      payload: req.body || {},
      actor: requestActor(req),
    });
    res.status(201).json(result);
  } catch (e) {
    res.status(e?.statusCode || 500).json({ error: e?.message || 'Failed to create key' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const apiKey = await updateApiKey({
      tenantId: req.tenantId,
      apiKeyId: req.params.id,
      payload: req.body || {},
      actor: requestActor(req),
    });
    res.json({ ok: true, apiKey });
  } catch (e) {
    res.status(e?.statusCode || 500).json({ error: e?.message || 'Failed to update key' });
  }
});

// Revoke key
router.delete('/:id', async (req, res) => {
  try {
    const apiKey = await revokeApiKey({
      tenantId: req.tenantId,
      apiKeyId: req.params.id,
      actor: requestActor(req),
      reason: req.body?.reason || req.query?.reason || null,
    });
    res.json({ ok: true, apiKey });
  } catch (e) {
    res.status(e?.statusCode || 500).json({ error: e?.message || 'Failed to revoke key' });
  }
});

module.exports = router;
