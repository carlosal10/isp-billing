// utils/paylink.js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Plan = require('../models/plan');
const Customer = require('../models/customers');

const TOKEN_TTL_DAYS = Number(process.env.PAYLINK_TTL_DAYS || 14);
const ISSUER = process.env.PAYLINK_ISSUER || 'isp-billing';
const AUDIENCE = process.env.PAYLINK_AUDIENCE || 'paylink';

/** Prefer explicit public URL; allow override per-call. */
function buildBaseUrl({ override } = {}) {
  if (override) return override.replace(/\/+$/,'');
  const envUrl =
    process.env.PUBLIC_BASE_URL ||
    process.env.CLIENT_URL ||
    '';
  return envUrl.replace(/\/+$/,'');
}

/** Compact uuid-like jti */
function jti() {
  return crypto.randomBytes(12).toString('base64url');
}

function signPayToken(payload, { expiresIn = `${TOKEN_TTL_DAYS}d`, secret, issuer = ISSUER, audience = AUDIENCE } = {}) {
  const key = secret || process.env.JWT_SECRET;
  if (!key) throw new Error('Missing JWT_SECRET');
  // include iss, aud, jti, subject = customerId
  const claims = {
    ...payload,
  };
  return jwt.sign(claims, key, {
    expiresIn,
    issuer,
    audience,
    subject: String(payload.customerId || ''),
    jwtid: jti(),
  });
}

/**
 * Strict verify with iss/aud checks and helpful errors.
 * Optionally pass {allowExpired:true} if you only want to read contents.
 */
function verifyPayToken(token, { secret, issuer = ISSUER, audience = AUDIENCE, allowExpired = false } = {}) {
  const key = secret || process.env.JWT_SECRET;
  if (!key) throw new Error('Missing JWT_SECRET');
  try {
    return jwt.verify(token, key, { issuer, audience });
  } catch (e) {
    if (allowExpired && e.name === 'TokenExpiredError') {
      return jwt.decode(token);
    }
    const msg =
      e.name === 'TokenExpiredError' ? 'Pay link expired' :
      e.name === 'JsonWebTokenError' ? 'Invalid pay link' :
      'Cannot verify pay link';
    const err = new Error(msg);
    err.cause = e;
    throw err;
  }
}

/**
 * Create a pay link for a tenant/customer/plan.
 * Optional: { baseUrl, ttlDays, secret }
 */
async function createPayLink({ tenantId, customerId, planId, dueAt, baseUrl, ttlDays, secret } = {}) {
  if (!tenantId || !customerId || !planId) throw new Error('Missing tenantId/customerId/planId');
  const expiresIn = `${Number(ttlDays || TOKEN_TTL_DAYS)}d`;
  const token = signPayToken({ tenantId, customerId, planId, dueAt }, { expiresIn, secret });
  const base = buildBaseUrl({ override: baseUrl });
  const path = `/pay?token=${encodeURIComponent(token)}`;
  const url = base ? `${base}${path}` : path;

  const shortBase = (process.env.PAYLINK_SHORT_BASE || '').replace(/\/+$/, '');
  const shortPath = `/pl/${encodeURIComponent(token)}`;
  const shortUrl = shortBase ? `${shortBase}${shortPath}` : shortPath;

  return { token, url, shortUrl, shortPath, expiresIn };
}

/**
 * Resolve pay info from token (server-trusted).
 * Returns minimal, tenant-scoped objects and a curated list of other plans.
 */
async function getPayInfo({ token, secret } = {}) {
  const decoded = verifyPayToken(token, { secret });
  const { tenantId, customerId, planId, dueAt } = decoded || {};
  if (!tenantId || !customerId || !planId) throw new Error('Invalid or outdated link');

  // Fetch only what you need; keep it lean.
  const [customer, currentPlan, otherPlans] = await Promise.all([
    Customer.findOne({ _id: customerId, tenantId }).select('_id name phone accountNumber status').lean(),
    Plan.findOne({ _id: planId, tenantId }).select('_id name description price duration active archived').lean(),
    Plan.find({ tenantId, active: true, archived: { $ne: true }, _id: { $ne: planId } })
        .select('_id name description price duration')
        .sort({ price: 1 })
        .limit(12)
        .lean(),
  ]);

  if (!customer) throw new Error('Customer not found for this link');
  if (!currentPlan || currentPlan.archived || currentPlan.active === false) {
    throw new Error('Plan no longer available');
  }

  // Normalize numeric price
  const price = Number(currentPlan.price);
  if (!Number.isFinite(price) || price < 1) throw new Error('Invalid plan price');

  return {
    tenantId: String(tenantId),
    customer: {
      _id: String(customer._id),
      name: customer.name,
      phone: customer.phone,
      accountNumber: customer.accountNumber,
      status: customer.status || 'active',
    },
    plan: {
      _id: String(currentPlan._id),
      name: currentPlan.name,
      description: currentPlan.description,
      price,
      duration: currentPlan.duration,
    },
    otherPlans,
    dueAt,
    // expose token iat/exp if you want the UI to show “expires in …”
    tokenMeta: {
      iat: decoded.iat,
      exp: decoded.exp,
      jti: decoded.jti,
    },
  };
}

module.exports = {
  createPayLink,
  getPayInfo,
  verifyPayToken,
  signPayToken,
  buildBaseUrl,
};
