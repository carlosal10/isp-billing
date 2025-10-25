// routes/tenant.js
const express = require('express');
const Tenant = require('../models/Tenant');
const { requireAuth, requireTenant } = require("../security/auth");
const { isValidIPv4 } = require('../utils/staticIpPool');
const router = express.Router();

// GET /api/tenant/me - current tenant info from req.tenantId
router.get("/me", async (req, res) => {
  if (!req.tenantId) return res.status(401).json({ ok:false, error:"Missing tenant" });
  try {
    const t = await Tenant.findById(req.tenantId).lean();
    return res.json({
      ok: true,
      id: String(req.tenantId),
      name: t?.name || "",
      subdomain: t?.subdomain ?? null,
      accountPrefix: t?.accountPrefix || "",
      staticIpPool: Array.isArray(t?.staticIpPool) ? t.staticIpPool : []
    });
  } catch {
    return res.status(500).json({ ok:false, error:"Failed to load tenant" });
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

// ---- Static IP pool management ----
// PUT /api/tenant/static/ip-pool { pool }
// Accepts an array of IPv4 strings or a single string with IPs separated by commas/newlines/spaces.
router.put('/static/ip-pool', async (req, res) => {
  try {
    let pool = req.body?.pool;
    // Support alternate key 'text'
    if ((pool == null || pool === '') && typeof req.body?.text === 'string') pool = req.body.text;

    let items = [];
    if (Array.isArray(pool)) {
      items = pool;
    } else if (typeof pool === 'string') {
      items = pool
        .split(/[\n,\s]+/g)
        .map((s) => String(s || '').trim())
        .filter(Boolean);
    } else {
      items = [];
    }

    const out = [];
    const seen = new Set();
    for (const v of items) {
      const ip = String(v || '').trim();
      if (!ip) continue;
      if (!isValidIPv4(ip)) continue; // only allow IPv4 in pool
      const key = ip;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ip);
      if (out.length >= 2048) break; // sanity limit
    }

    const t = await Tenant.findByIdAndUpdate(
      req.tenantId,
      { $set: { staticIpPool: out } },
      { new: true }
    ).lean();
    return res.json({ ok: true, staticIpPool: Array.isArray(t?.staticIpPool) ? t.staticIpPool : [] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Failed to save static IP pool' });
  }
});

module.exports = router;
