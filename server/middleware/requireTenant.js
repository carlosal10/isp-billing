// middleware/requireTenant.js

const Membership = require('../models/Membership');

function normalizeTenantId(value) {
  if (Array.isArray(value)) return null;
  const normalized = String(value || '').trim();
  return normalized || null;
}

function resolveTenantContext(req) {
  if (req.user?.aud !== 'tenant-staff' || req.authRealm !== 'tenant-staff') {
    return { error: 'Tenant staff access required', status: 401 };
  }

  const ispClaim = normalizeTenantId(req.user?.ispId);
  const tenantClaim = normalizeTenantId(req.user?.tenantId);
  if (ispClaim && tenantClaim && ispClaim !== tenantClaim) {
    return { error: 'Conflicting tenant token claims', status: 401 };
  }

  const claimTenantId = ispClaim || tenantClaim;
  if (!claimTenantId) {
    return { error: 'Missing tenant token claim', status: 401 };
  }

  const headerTenantId = normalizeTenantId(req.headers?.['x-isp-id']);
  if (headerTenantId && headerTenantId !== claimTenantId) {
    return { error: 'Tenant header does not match access token', status: 403 };
  }

  return { tenantId: claimTenantId };
}

async function findMembership(userId, tenantId) {
  return Membership.findOne({ user: userId, tenant: tenantId })
    .select({ role: 1 })
    .lean();
}

function createRequireTenant({ membershipLookup = findMembership } = {}) {
  return async function requireTenant(req, res, next) {
    try {
      const resolved = resolveTenantContext(req);
      if (resolved.error) {
        return res.status(resolved.status).json({ ok: false, error: resolved.error });
      }

      const userId = normalizeTenantId(req.user?.sub);
      if (!userId) {
        return res.status(401).json({ ok: false, error: 'Missing user token claim' });
      }

      const membership = await membershipLookup(userId, resolved.tenantId);
      if (!membership) {
        return res.status(403).json({ ok: false, error: 'No membership in tenant' });
      }

      req.tenantId = resolved.tenantId;
      req.membership = membership;
      req.role = membership.role;
      return next();
    } catch (error) {
      console.error('Tenant membership check failed:', error?.message || error);
      return res.status(500).json({ ok: false, error: 'Tenant membership check failed' });
    }
  };
}

const requireTenant = createRequireTenant();

module.exports = requireTenant;
module.exports.createRequireTenant = createRequireTenant;
module.exports.normalizeTenantId = normalizeTenantId;
module.exports.resolveTenantContext = resolveTenantContext;

