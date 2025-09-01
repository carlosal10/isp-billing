// utils/jwt.js
const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error("JWT_SECRET is not set");

function signTenantAccessToken({ user, tenantId }) {
  return jwt.sign(
    { sub: String(user._id), email: user.email, ispId: String(tenantId) },
    SECRET,
    { expiresIn: "15m" }
  );
}

function signPlatformAccessToken({ admin }) {
  return jwt.sign(
    { sub: String(admin._id), email: admin.email, aud: "platform-admin" },
    SECRET,
    { expiresIn: "15m" }
  );
}

module.exports = { signTenantAccessToken, signPlatformAccessToken };
