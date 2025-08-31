const jwt = require("jsonwebtoken");

function signTenantAccessToken({ user, tenantId }) {
  return jwt.sign(
    { sub: String(user._id), email: user.email, ispId: String(tenantId) },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
}

function signPlatformAccessToken({ admin }) {
  return jwt.sign(
    { sub: String(admin._id), email: admin.email, aud: "platform-admin" },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
}

module.exports = { signTenantAccessToken, signPlatformAccessToken };
