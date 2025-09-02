// middleware/requireTenant.js

/**
 * Ensures we have a tenant in the request context.
 * Priority: x-isp-id header → JWT claim (req.user.ispId)
 */
module.exports = function requireTenant(req, res, next) {
  const headerTid = req.headers["x-isp-id"];
  const claimTid = req.user?.ispId || req.user?.tenantId; // allow either claim name
  const tenantId = headerTid || claimTid;

  if (!tenantId) {
    return res.status(401).json({ ok: false, error: "Missing tenant (x-isp-id)" });
  }
  req.tenantId = String(tenantId);
  return next();
};
