// server/utils/jwt.js
const jwt = require("jsonwebtoken");

/**
 * IMPORTANT: All server instances must share the same JWT_SECRET.
 * Keep payloads minimal to reduce token size and rotation cost.
 */
const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error("JWT_SECRET is not set");

/**
 * Signs an access token for a tenant-scoped user session.
 * Payload: { sub, email, ispId }
 * Expires in 15 minutes (short-lived; refresh will extend).
 */
function signTenantAccessToken({ user, tenantId }) {
  if (!user || !tenantId) {
    throw new Error("signTenantAccessToken: user and tenantId are required");
  }
  return jwt.sign(
    { sub: String(user._id), email: user.email, ispId: String(tenantId) },
    SECRET,
    { expiresIn: "15m" }
  );
}

/**
 * Signs an access token for platform-admin flows (separate audience).
 */
function signPlatformAccessToken({ admin }) {
  if (!admin) throw new Error("signPlatformAccessToken: admin is required");
  return jwt.sign(
    { sub: String(admin._id), email: admin.email, aud: "platform-admin" },
    SECRET,
    { expiresIn: "15m" }
  );
}

/**
 * Optional helper if you need to verify a token in utilities/middleware.
 * You can keep your existing middleware if you already verify there.
 */
function verifyAccessToken(token) {
  return jwt.verify(token, SECRET);
}

module.exports = {
  signTenantAccessToken,
  signPlatformAccessToken,
  verifyAccessToken,
};
