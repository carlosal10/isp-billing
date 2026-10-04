// server/routes/tenantAuth.js
const express = require("express");
const bcrypt = require("bcryptjs");            // ← pure JS, reliable on cloud
const { z } = require("zod");
const Tenant = require("../models/Tenant");
const User = require("../models/User");
const Membership = require("../models/Membership");
const requireAuth = require("../middleware/requireAuth");
const requireTenant = require("../middleware/requireTenant");
const { signTenantAccessToken } = require("../utils/jwt");
const {
  consumeRefreshToken,
  issueRefreshToken,
  revokeRefreshToken,
} = require('../services/refreshTokenService');
const {
  loginLimiter,
  refreshLimiter,
  registrationLimiter,
} = require("../middleware/riskRateLimits");

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

/* ----------------- Register ----------------- */
router.post("/register", registrationLimiter, async (req, res) => {
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
    const { displayName, password } = parsed.data;
    const tenantName = parsed.data.tenantName.trim();
    const normalizedEmail = parsed.data.email.trim().toLowerCase();

    const existing = await User.findOne({ email: normalizedEmail }).lean();
    if (existing) {
      console.warn('[auth] register rejected because identity already exists');
      return res.status(409).json({ ok: false, error: "Email already exists" });
    }

    const tenant = await Tenant.create({ name: tenantName });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      email: normalizedEmail,
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
      user: { id: String(user._id), email: user.email, displayName: user.displayName, role: "owner" },
      ispId: String(tenant._id),
      role: "owner",
      accessToken,
      refreshToken,
    });
  } catch (e) {
    console.error("[auth] register error:", e?.message || e);
    if (e?.code === 11000) {
      const field = Object.keys(e.keyPattern || {})[0];
      return res.status(409).json({ ok: false, error: field === 'name' ? 'That ISP workspace name is already in use' : 'That email address is already registered' });
    }
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/* ----------------- Login ----------------- */
router.post("/login", loginLimiter, async (req, res) => {
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

    const { password, ispId } = parsed.data;
    const email = parsed.data.email.trim().toLowerCase();
    const user = await User.findOne({ email });
    if (!user || !user.isActive) {
      console.warn('[auth] login rejected for invalid or inactive identity');
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
      user: { id: String(user._id), email: user.email, displayName: user.displayName, role: mem.role },
      ispId: String(tenantId),
      role: mem.role,
      accessToken,
      refreshToken,
    });
  } catch (e) {
    console.error("[auth] login error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/* ----------------- Session Introspection ----------------- */
router.get("/me", requireAuth, requireTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const userId = String(req.user.sub);

    const user = await User.findById(userId, { email: 1, displayName: 1, isActive: 1 }).lean();

    if (!user || !user.isActive) {
      return res.status(401).json({ ok: false, error: "User disabled" });
    }

    return res.json({
      ok: true,
      ispId: tenantId,
      role: req.role,
      user: {
        id: String(user._id),
        email: user.email,
        displayName: user.displayName,
        role: req.role,
      },
    });
  } catch (e) {
    return res.status(401).json({ ok: false, error: "Invalid or expired token" });
  }
});

/* ----------------- Refresh (rotate) ----------------- */
router.post("/refresh", refreshLimiter, async (req, res) => {
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

    const current = await consumeRefreshToken(parsed.data.refreshToken);
    if (!current) {
      console.warn('[auth] refresh rejected');
      return res.status(401).json({ ok: false, error: "Invalid refresh" });
    }

    const user = await User.findById(current.user);
    if (!user || !user.isActive) {
      return res.status(401).json({ ok: false, error: "User disabled" });
    }

    const membership = await Membership.findOne({ user: current.user, tenant: current.tenant })
      .select({ role: 1 })
      .lean();
    if (!membership) {
      return res.status(403).json({ ok: false, error: "No access to tenant" });
    }

    const nextRaw = await issueRefreshToken({
      userId: current.user,
      tenantId: current.tenant,
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
      role: membership.role,
      user: { id: String(user._id), email: user.email, displayName: user.displayName, role: membership.role },
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
      await revokeRefreshToken(token);
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
