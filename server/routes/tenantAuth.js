const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { z } = require("zod");
const Tenant = require("../models/Tenant");
const User = require("../models/User");
const Membership = require("../models/Membership");
const RefreshToken = require("../models/RefreshToken");
const { signTenantAccessToken } = require("../utils/jwt");

const router = express.Router();

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

function refreshExpiry(days = Number(process.env.REFRESH_TTL_DAYS || 30)) {
  return new Date(Date.now() + days * 86400 * 1000);
}

async function issueRefreshToken({ userId, tenantId }) {
  const token = crypto.randomBytes(48).toString("base64url");
  await RefreshToken.create({ token, user: userId, tenant: tenantId, expiresAt: refreshExpiry() });
  return token;
}

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid payload" });
    const { tenantName, displayName, email, password } = parsed.data;

    const existing = await User.findOne({ email }).lean();
    if (existing) return res.status(409).json({ ok: false, error: "Email already exists" });

    const tenant = await Tenant.create({ name: tenantName });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      email, passwordHash, displayName, isActive: true, primaryTenant: tenant._id,
    });
    await Membership.create({ user: user._id, tenant: tenant._id, role: "owner" });

    const accessToken = signTenantAccessToken({ user, tenantId: tenant._id });
    const refreshToken = await issueRefreshToken({ userId: user._id, tenantId: tenant._id });

    res.json({
      ok: true,
      user: { id: String(user._id), email: user.email, displayName: user.displayName },
      ispId: String(tenant._id),
      accessToken,
      refreshToken,
    });
  } catch (e) {
    console.error("register error:", e);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid payload" });

    const { email, password, ispId } = parsed.data;
    const user = await User.findOne({ email });
    if (!user || !user.isActive) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    // resolve tenant
    let tenantId = ispId || user.primaryTenant;
    if (!tenantId) {
      const m = await Membership.findOne({ user: user._id }).lean();
      tenantId = m?.tenant;
    }
    if (!tenantId) return res.status(400).json({ ok: false, error: "No tenant context" });

    const mem = await Membership.findOne({ user: user._id, tenant: tenantId }).lean();
    if (!mem) return res.status(403).json({ ok: false, error: "No access to tenant" });

    const accessToken = signTenantAccessToken({ user, tenantId });
    const refreshToken = await issueRefreshToken({ userId: user._id, tenantId });

    res.json({
      ok: true,
      user: { id: String(user._id), email: user.email, displayName: user.displayName },
      ispId: String(tenantId),
      accessToken,
      refreshToken,
    });
  } catch (e) {
    console.error("login error:", e);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

router.post("/refresh", async (req, res) => {
  try {
    const parsed = RefreshSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid payload" });

    const current = await RefreshToken.findOne({ token: parsed.data.refreshToken });
    if (!current || current.isRevoked || current.expiresAt < new Date()) {
      return res.status(401).json({ ok: false, error: "Invalid refresh" });
    }

    const user = await User.findById(current.user);
    if (!user || !user.isActive) return res.status(401).json({ ok: false, error: "User disabled" });

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
    return res.json({
      ok: true,
      accessToken,
      refreshToken: nextRaw,
      ispId: String(current.tenant),
      user: { id: String(user._id), email: user.email, displayName: user.displayName },
    });
  } catch (e) {
    console.error("refresh error:", e);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// POST /api/auth/logout
router.post("/logout", async (req, res) => {
  try {
    const token = req.body?.refreshToken;
    if (token) await RefreshToken.updateMany({ token }, { $set: { isRevoked: true } });
    res.json({ ok: true });
  } catch {
    res.json({ ok: true });
  }
});

module.exports = router;
