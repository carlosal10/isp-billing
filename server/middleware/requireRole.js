// middleware/requireRole.js
const Membership = require("../models/Membership");

/**
 * Ensures the authenticated user has one of the required roles in the current tenant.
 * Usage:
 *   app.get('/route',
 *     requireAuth, requireTenant, requireRole('owner','admin'),
 *     handler
 *   )
 *
 * Notes:
 * - If your JWT carries a platform admin flag (e.g., user.isPlatformAdmin),
 *   we let them through unless you explicitly pass only 'owner' and disallow override.
 */
module.exports = function requireRole(...roles) {
  // If no roles passed, treat as "any" membership
  const required = roles.length ? roles : ["any"];

  return async (req, res, next) => {
    try {
      const userId = req.user?.sub || req.user?.id || req.user?._id;
      const tenantId = req.tenantId;

      if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized (no user)" });
      if (!tenantId) return res.status(401).json({ ok: false, error: "Unauthorized (no tenant)" });

      // Optional platform override
      if (req.user?.isPlatformAdmin === true) {
        // You can restrict this override if you need:
        // if (!required.includes('owner')) return next();
        return next();
      }

      // Look up membership
      const m = await Membership.findOne({ user: userId, tenant: tenantId })
        .select({ role: 1 }) // only role
        .lean();

      if (!m) return res.status(403).json({ ok: false, error: "No membership in tenant" });

      // "any" means any membership is fine
      if (required.includes("any")) return next();

      if (!required.includes(m.role)) {
        return res.status(403).json({ ok: false, error: "Insufficient role" });
      }

      req.role = m.role;
      return next();
    } catch (e) {
      console.error("Role check failed:", e?.message || e);
      return res.status(500).json({ ok: false, error: "Role check failed" });
    }
  };
};
