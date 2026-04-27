const requireAuth = require("../middleware/requireAuth");
const requireTenant = require("../middleware/requireTenant");
const {
  signTenantAccessToken,
  signPlatformAccessToken,
  verifyAccessToken,
} = require("../utils/jwt");

function signAccessToken({ user, tenantId }) {
  return signTenantAccessToken({ user, tenantId });
}

function refreshExpiry(days = Number(process.env.REFRESH_TTL_DAYS || 30)) {
  return new Date(Date.now() + days * 86400 * 1000);
}

module.exports = {
  signAccessToken,
  signTenantAccessToken,
  signPlatformAccessToken,
  verifyAccessToken,
  refreshExpiry,
  requireAuth,
  requireTenant,
};
