const Membership = require("../models/Membership");

/**
 * Ensures user has one of roles in current tenant.
 * Usage: app.get('/route', requireAuth, requireTenant, requireRole('owner','admin'), handler)
 */
module.exports = function requireRole(...roles) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.sub || req.user?.id;
      if (!userId || !req.tenantId) return res.status(401).json({ ok: false, error: "Unauthorized" });
      const m = await Membership.findOne({ user: userId, tenant: req.tenantId }).lean();
      if (!m) return res.status(403).json({ ok: false, error: "No membership" });
      if (!roles.includes(m.role) && !roles.includes("any")) {
        return res.status(403).json({ ok: false, error: "Insufficient role" });
      }
      req.role = m.role;
      next();
    } catch (e) {
      res.status(500).json({ ok: false, error: "Role check failed" });
    }
  };
};
