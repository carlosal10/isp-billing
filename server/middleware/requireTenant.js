// middleware/requireTenant.js

/**
 * Ensures we have a tenant in the request context.
 * Priority: x-isp-id header → JWT claim → subdomain
 */
const Tenant = require('../models/Tenant');

module.exports = async function requireTenant(req, res, next) {
  try {
    const headerTid = req.headers['x-isp-id'];
    const claimTid = req.user?.ispId || req.user?.tenantId; // allow either claim name
    let tenantId = headerTid || claimTid;

    // Derive from subdomain if not provided via header/claim
    if (!tenantId) {
      const root = process.env.ROOT_DOMAIN || null; // e.g., isp.example.com
      const host = String(req.hostname || '').toLowerCase();
      if (root && host.endsWith(`.${root}`)) {
        const sub = host.slice(0, -1 * (root.length + 1));
        if (sub && sub !== 'www') {
          const t = await Tenant.findOne({ subdomain: sub }).lean();
          if (t) tenantId = String(t._id);
        }
      }
    }

    if (!tenantId) {
      return res.status(401).json({ ok: false, error: 'Missing tenant (x-isp-id)' });
    }
    req.tenantId = String(tenantId);
    return next();
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Tenant resolution failed' });
  }
};

