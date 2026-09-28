// server/utils/jwt.js
const jwt = require("jsonwebtoken");

/**
 * IMPORTANT: All server instances must share the same JWT_SECRET.
 * Keep payloads minimal to reduce token size and rotation cost.
 */
const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error("JWT_SECRET is not set");

const ACCESS_TOKEN_ISSUER = process.env.JWT_ISSUER || "swiftbridge-api";
const ACCESS_TOKEN_AUDIENCES = Object.freeze({
  TENANT_STAFF: "tenant-staff",
  PLATFORM_ADMIN: "platform-admin",
  CUSTOMER_PORTAL: "customer-portal",
});
const VERIFY_OPTIONS = Object.freeze({
  algorithms: ["HS256"],
  issuer: ACCESS_TOKEN_ISSUER,
});

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
    {
      sub: String(user._id),
      email: user.email,
      ispId: String(tenantId),
      tokenUse: "access",
    },
    SECRET,
    {
      algorithm: "HS256",
      audience: ACCESS_TOKEN_AUDIENCES.TENANT_STAFF,
      expiresIn: "15m",
      issuer: ACCESS_TOKEN_ISSUER,
    }
  );
}

/**
 * Signs an access token for platform-admin flows (separate audience).
 */
function signPlatformAccessToken({ admin }) {
  if (!admin) throw new Error("signPlatformAccessToken: admin is required");
  return jwt.sign(
    {
      sub: String(admin._id),
      email: admin.email,
      username: admin.username || null,
      role: "platform-admin",
      isSuper: Boolean(admin.isSuper),
      sessionVersion: Number.isFinite(Number(admin.sessionVersion))
        ? Number(admin.sessionVersion)
        : 0,
      tokenUse: "access",
    },
    SECRET,
    {
      algorithm: "HS256",
      audience: ACCESS_TOKEN_AUDIENCES.PLATFORM_ADMIN,
      expiresIn: "15m",
      issuer: ACCESS_TOKEN_ISSUER,
    }
  );
}

/**
 * Signs an access token for customer portal sessions.
 */
function signCustomerPortalAccessToken({ tenant, customer }) {
  if (!tenant || !customer) {
    throw new Error("signCustomerPortalAccessToken: tenant and customer are required");
  }
  return jwt.sign(
    {
      sub: String(customer._id),
      tenantId: String(tenant._id),
      tenantName: tenant.name || null,
      accountNumber: customer.accountNumber || null,
      customerName: customer.name || null,
      role: "customer",
      sessionVersion: Number(customer.portalProfile?.sessionVersion || 0),
      tokenUse: "access",
    },
    SECRET,
    {
      algorithm: "HS256",
      audience: ACCESS_TOKEN_AUDIENCES.CUSTOMER_PORTAL,
      expiresIn: "8h",
      issuer: ACCESS_TOKEN_ISSUER,
    }
  );
}

/**
 * Optional helper if you need to verify a token in utilities/middleware.
 * You can keep your existing middleware if you already verify there.
 */
function verifyAccessToken(token, { audience } = {}) {
  if (!audience) throw new Error("verifyAccessToken: audience is required");
  const claims = jwt.verify(token, SECRET, { ...VERIFY_OPTIONS, audience });
  if (claims?.tokenUse !== "access") {
    throw new Error("Invalid token use");
  }
  return claims;
}

function verifyTenantAccessToken(token) {
  const claims = verifyAccessToken(token, { audience: ACCESS_TOKEN_AUDIENCES.TENANT_STAFF });
  if (!claims?.sub || !claims?.ispId) throw new Error("Invalid tenant access token claims");
  return claims;
}

function verifyPlatformAccessToken(token) {
  const claims = verifyAccessToken(token, { audience: ACCESS_TOKEN_AUDIENCES.PLATFORM_ADMIN });
  if (!claims?.sub) throw new Error("Invalid platform access token claims");
  return claims;
}

function verifyCustomerPortalAccessToken(token) {
  const claims = verifyAccessToken(token, { audience: ACCESS_TOKEN_AUDIENCES.CUSTOMER_PORTAL });
  if (!claims?.sub || !claims?.tenantId) throw new Error("Invalid portal access token claims");
  return claims;
}

module.exports = {
  ACCESS_TOKEN_AUDIENCES,
  ACCESS_TOKEN_ISSUER,
  signCustomerPortalAccessToken,
  signTenantAccessToken,
  signPlatformAccessToken,
  verifyAccessToken,
  verifyCustomerPortalAccessToken,
  verifyPlatformAccessToken,
  verifyTenantAccessToken,
};
