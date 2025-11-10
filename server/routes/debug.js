// routes/debug.js
const express = require("express");
const router = express.Router();
const { requireRole } = require('../middleware');
const { resetPoolEntry } = require('../utils/mikrotikConnectionManager');

router.get("/whoami", (req, res) => {
  res.json({
    ok: true,
    userFromJwt: req.user || null,
    tenantId: req.tenantId || null,
    sawAuthHeader: Boolean(req.headers.authorization),
    sawIspIdHeader: req.headers["x-isp-id"] || null,
  });
});

// Reset a mikrotik pool entry for the current tenant.
// Body: { host: string, port?: number }
// Requires tenant-level owner/admin role.
router.post('/mikrotik/reset', requireRole('owner','admin'), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { host, port } = req.body || {};
    if (!host) return res.status(400).json({ ok: false, error: 'Missing host' });
    const ok = resetPoolEntry(tenantId, String(host).trim(), port ? Number(port) : undefined);
    if (!ok) return res.status(404).json({ ok: false, error: 'Entry not found or reset failed' });
    return res.json({ ok: true, message: 'Reset scheduled' });
  } catch (e) {
    console.error('mikrotik reset failed', e?.message || e);
    return res.status(500).json({ ok: false, error: 'Reset failed' });
  }
});

module.exports = router;

