// server/routes/tenantAuth.js
const express = require("express");
const bcrypt = require("bcryptjs");            // ← pure JS, reliable on cloud
const crypto = require("crypto");
const { z } = require("zod");
const Tenant = require("../models/Tenant");
const User = require("../models/User");
const Membership = require("../models/Membership");
const RefreshToken = require("../models/RefreshToken");
const { signTenantAccessToken } = require("../utils/jwt");

const router = express.Router();

/* ----------------- Schemas ----------------- */
const RegisterSchema = z.object({
  tenantName: z.string().min(1),
  displayName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  ispId: z.string().optional(),
});

const RefreshSchema = z.object({ refreshToken: z.string().min(1) });

/* ----------------- Helpers ----------------- */
function refreshExpiry(days = Number(process.env.REFRESH_TTL_DAYS || 30)) {
  return new Date(Date.now() + days * 86400 * 1000);
}

async function issueRefreshToken({ userId, tenantId }) {
  const token = crypto.randomBytes(48).toString("base64url");
  await RefreshToken.create({
    token,
    user: userId,
    tenant: tenantId,
    expiresAt: refreshExpiry(),
    isRevoked: false,
  });
  return token;
}

/* ----------------- Register ----------------- */
router.post("/register", async (req, res) => {
  try {
    console.log('[auth] register request', {
      ip: req.ip,
      origin: req.headers.origin || null,
      referer: req.headers.referer || null,
    });
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      console.warn('[auth] register invalid payload', parsed.error?.issues || []);
      return res.status(400).json({ ok: false, error: "Invalid payload" });
    }
    const { tenantName, displayName, email, password } = parsed.data;

    const existing = await User.findOne({ email }).lean();
    if (existing) {
      console.warn('[auth] register email exists', { email });
      return res.status(409).json({ ok: false, error: "Email already exists" });
    }

    const tenant = await Tenant.create({ name: tenantName });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      email,
      passwordHash,
      displayName,
      isActive: true,
      primaryTenant: tenant._id,
    });
    await Membership.create({ user: user._id, tenant: tenant._id, role: "owner" });

    const accessToken = signTenantAccessToken({ user, tenantId: tenant._id });

    let refreshToken;
    try {
      refreshToken = await issueRefreshToken({ userId: user._id, tenantId: tenant._id });
    } catch (e) {
      console.error("REGISTER refresh insert failed:", e);
      return res.status(500).json({ ok: false, error: "Failed to issue refresh token" });
    }

    // Log token issuance (no secrets)
    try {
      console.log('[auth] tokens issued', {
        flow: 'register',
        userId: String(user._id),
        tenantId: String(tenant._id),
        hasAccess: !!accessToken,
        hasRefresh: !!refreshToken,
        accessBytes: accessToken ? accessToken.length : 0,
        refreshBytes: refreshToken ? refreshToken.length : 0,
      });
    } catch {}

    console.log('[auth] register success', { userId: String(user._id), tenantId: String(tenant._id) });
    return res.json({
      ok: true,
      user: { id: String(user._id), email: user.email, displayName: user.displayName },
      ispId: String(tenant._id),
      accessToken,
      refreshToken,
    });
  } catch (e) {
    console.error("[auth] register error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/* ----------------- Login ----------------- */
router.post("/login", async (req, res) => {
  try {
    console.log('[auth] login request', {
      ip: req.ip,
      origin: req.headers.origin || null,
      hasAuthHeader: !!req.headers.authorization,
      hasAtCookie: !!req.cookies?.at,
    });
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      console.warn('[auth] login invalid payload', parsed.error?.issues || []);
      return res.status(400).json({ ok: false, error: "Invalid payload" });
    }

    const { email, password, ispId } = parsed.data;
    const user = await User.findOne({ email });
    if (!user || !user.isActive) {
      console.warn('[auth] login invalid user or inactive', { email, isActive: user?.isActive ?? null });
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash || "");
    if (!ok) {
      console.warn('[auth] login bad password', { userId: String(user._id) });
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    // resolve tenant context
    let tenantId = ispId || user.primaryTenant;
    if (!tenantId) {
      const m = await Membership.findOne({ user: user._id }).lean();
      tenantId = m?.tenant;
    }
    if (!tenantId) {
      console.warn('[auth] login no tenant context', { userId: String(user._id) });
      return res.status(400).json({ ok: false, error: "No tenant context" });
    }

    const mem = await Membership.findOne({ user: user._id, tenant: tenantId }).lean();
    if (!mem) {
      console.warn('[auth] login no membership', { userId: String(user._id), tenantId: String(tenantId) });
      return res.status(403).json({ ok: false, error: "No access to tenant" });
    }

    const accessToken = signTenantAccessToken({ user, tenantId });
    const refreshToken = await issueRefreshToken({ userId: user._id, tenantId });

    // Log token issuance (no secrets)
    try {
      console.log('[auth] tokens issued', {
        flow: 'login',
        userId: String(user._id),
        tenantId: String(tenantId),
        hasAccess: !!accessToken,
        hasRefresh: !!refreshToken,
        accessBytes: accessToken ? accessToken.length : 0,
        refreshBytes: refreshToken ? refreshToken.length : 0,
      });
    } catch {}

    console.log('[auth] login success', { userId: String(user._id), tenantId: String(tenantId) });
    return res.json({
      ok: true,
      user: { id: String(user._id), email: user.email, displayName: user.displayName },
      ispId: String(tenantId),
      accessToken,
      refreshToken,
    });
  } catch (e) {
    console.error("[auth] login error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/* ----------------- Refresh (rotate) ----------------- */
router.post("/refresh", async (req, res) => {
  try {
    console.log('[auth] refresh request', {
      ip: req.ip,
      hasBodyToken: !!req.body?.refreshToken,
      hasRtCookie: !!req.cookies?.rt,
    });
    const parsed = RefreshSchema.safeParse(req.body);
    if (!parsed.success) {
      console.warn('[auth] refresh invalid payload', parsed.error?.issues || []);
      return res.status(400).json({ ok: false, error: "Invalid payload" });
    }

    const current = await RefreshToken.findOne({ token: parsed.data.refreshToken });
    if (!current || current.isRevoked || current.expiresAt < new Date()) {
      console.warn('[auth] refresh invalid token', { reason: !current ? 'not_found' : current.isRevoked ? 'revoked' : 'expired' });
      return res.status(401).json({ ok: false, error: "Invalid refresh" });
    }

    const user = await User.findById(current.user);
    if (!user || !user.isActive) {
      return res.status(401).json({ ok: false, error: "User disabled" });
    }

    // rotate: revoke old, mint new
    await RefreshToken.updateOne({ _id: current._id }, { $set: { isRevoked: true } });

    const nextRaw = crypto.randomBytes(48).toString("base64url");
    await RefreshToken.create({
      token: nextRaw,
      user: current.user,
      tenant: current.tenant,
      expiresAt: refreshExpiry(),
      isRevoked: false,
    });

    const accessToken = signTenantAccessToken({ user, tenantId: current.tenant });

    // Log token issuance (no secrets)
    try {
      console.log('[auth] tokens issued', {
        flow: 'refresh',
        userId: String(user._id),
        tenantId: String(current.tenant),
        hasAccess: !!accessToken,
        hasRefresh: !!nextRaw,
        accessBytes: accessToken ? accessToken.length : 0,
        refreshBytes: nextRaw ? nextRaw.length : 0,
      });
    } catch {}

    console.log('[auth] refresh success', { userId: String(user._id), tenantId: String(current.tenant) });
    return res.json({
      ok: true,
      accessToken,
      refreshToken: nextRaw,
      ispId: String(current.tenant),
      user: { id: String(user._id), email: user.email, displayName: user.displayName },
    });
  } catch (e) {
    console.error("[auth] refresh error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/* ----------------- Logout ----------------- */
router.post("/logout", async (req, res) => {
  try {
    const token = req.body?.refreshToken;
    if (token) {
      await RefreshToken.updateMany({ token }, { $set: { isRevoked: true } });
    }
    console.log('[auth] logout', {
      ip: req.ip,
      hadBodyToken: !!req.body?.refreshToken,
      hadRtCookie: !!req.cookies?.rt,
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error("[auth] logout error:", e?.message || e);
    return res.json({ ok: true });
  }
});

module.exports = router;
