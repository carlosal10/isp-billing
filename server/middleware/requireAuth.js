// middleware/requireAuth.js
const { readBearerToken } = require("./bearerToken");
const { verifyTenantAccessToken } = require("../utils/jwt");

/**
 * Verifies a Bearer JWT and attaches claims to req.user
 * - Skips CORS preflight (OPTIONS)
 * - Accepts "Authorization: Bearer <token>"
 * - Accepts tenant-staff access tokens only
 */
module.exports = function requireAuth(req, res, next) {
  if (req.method === "OPTIONS") return res.sendStatus(204);

  const token = readBearerToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing token" });
  }

  try {
    const claims = verifyTenantAccessToken(token);
    req.user = claims;
    req.authRealm = "tenant-staff";
    req.authToken = token;
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "Invalid tenant access token" });
  }
};
