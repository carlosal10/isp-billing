module.exports = function requireTenant(req, res, next) {
  const tenantId = req.headers["x-isp-id"] || req.user?.ispId;
  if (!tenantId) return res.status(401).json({ ok: false, error: "Missing tenant (x-isp-id)" });
  req.tenantId = String(tenantId);
  next();
};
