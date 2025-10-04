const express = require('express');
const Tenant = require('../models/Tenant');

const router = express.Router();

// GET /api/tenant/me - current tenant info from req.tenantId
router.get('/me', async (req, res) => {
  try {
    const t = await Tenant.findById(req.tenantId).lean();
    return res.json({ ok: true, id: String(req.tenantId), name: t?.name || '', subdomain: t?.subdomain || null, accountPrefix: t?.accountPrefix || '' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Failed to load tenant' });
  }
});

// PUT /api/tenant/subdomain - set or update subdomain for this tenant
router.put('/subdomain', async (req, res) => {
  try {
    const { subdomain } = req.body || {};
    if (!subdomain || !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(String(subdomain))) {
      return res.status(400).json({ ok: false, error: 'Invalid subdomain' });
    }
    // Ensure uniqueness
    const exists = await Tenant.findOne({ subdomain: String(subdomain).toLowerCase(), _id: { $ne: req.tenantId } }).select('_id').lean();
    if (exists) return res.status(409).json({ ok: false, error: 'Subdomain already taken' });

    const t = await Tenant.findByIdAndUpdate(
      req.tenantId,
      { $set: { subdomain: String(subdomain).toLowerCase() } },
      { new: true }
    ).lean();

    const root = process.env.ROOT_DOMAIN || null;
    const url = root && t?.subdomain ? `https://${t.subdomain}.${root}` : null;
    return res.json({ ok: true, subdomain: t?.subdomain || null, url });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Failed to set subdomain' });
  }
});

// ---- Account number prefix (tenant setting) ----
// PUT /api/tenant/account/prefix { prefix }
router.put('/account/prefix', async (req, res) => {
  try {
    const { prefix } = req.body || {};
    const p = String(prefix || '').trim();
    if (p.length > 20) return res.status(400).json({ ok: false, error: 'Prefix too long (max 20 chars)' });
    const t = await Tenant.findByIdAndUpdate(req.tenantId, { $set: { accountPrefix: p } }, { new: true }).lean();
    return res.json({ ok: true, accountPrefix: t?.accountPrefix || '' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Failed to set account prefix' });
  }
});

module.exports = router;
