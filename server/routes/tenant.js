const express = require('express');
const Tenant = require('../models/Tenant');

const router = express.Router();

// GET /api/tenant/me - current tenant info from req.tenantId
router.get('/me', async (req, res) => {
  try {
    const t = await Tenant.findById(req.tenantId).lean();
    return res.json({ ok: true, id: String(req.tenantId), name: t?.name || '' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Failed to load tenant' });
  }
});

module.exports = router;

