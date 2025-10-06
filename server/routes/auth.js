// server/routes/auth.js  (CommonJS, unified)
const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const { z } = require("zod");
const Tenant = require("../models/Tenant");
const User = require("../models/User");
const Membership = require("../models/Membership");
const RefreshToken = require("../models/RefreshToken");
const { signAccessToken, refreshExpiry } = require("../security/auth");

// ---- if you still have rows with plain `token`, consider migrating to tokenHash later
function hashToken(t) {
  return crypto.createHash("sha256").update(t).digest("hex");
}

const router = express.Router();

/* --------- helpers --------- */
async function resolveTenantIdForLogin(user, ispIdFromBody) {
  if (ispIdFromBody) return ispIdFromBody;
  if (user.primaryTenant) return user.primaryTenant;
  const m = await Membership.findOne({ user: user._id }).lean();
  return m?.tenant || null;
}

/* --------- schemas --------- */
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

/* --------- register --------- */
router.post("/register", async (req, res) => {
  try {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid payload" });

    const { tenantName, displayName, email, password } = parsed.data;
    const exists = await User.findOne({ email }).lean();
    if (exists) return res.status(409).json({ ok: false, error: "Email already exists" });

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

    const accessToken = signAccessToken({ user, tenantId: tenant._id });
    const rawRefresh = crypto.randomBytes(48).toString("base64url");
    await RefreshToken.create({
      tokenHash: hashToken(rawRefresh), // hashed at rest
      user: user._id,
      tenant: tenant._id,
      expiresAt: refreshExpiry(),
      isRevoked: false,
    });

    return res.json({
      ok: true,
      user: { id: String(user._id), email: user.email, displayName: user.displayName },
      ispId: String(tenant._id),
      accessToken,
      refreshToken: rawRefresh,
    });
  } catch (e) {
    console.error("register error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/* --------- login --------- */
router.post("/login", async (req, res) => {
  try {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid payload" });

    const { email, password, ispId } = parsed.data;
    const user = await User.findOne({ email });
    if (!user || !user.isActive) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.passwordHash || "");
    if (!ok) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    const tenantId = await resolveTenantIdForLogin(user, ispId);
    if (!tenantId) return res.status(400).json({ ok: false, error: "No tenant context" });

    const mem = await Membership.findOne({ user: user._id, tenant: tenantId }).lean();
    if (!mem) return res.status(403).json({ ok: false, error: "No membership for tenant" });

    const accessToken = signAccessToken({ user, tenantId });
    const rawRefresh = crypto.randomBytes(48).toString("base64url");
    await RefreshToken.create({
      tokenHash: hashToken(rawRefresh),
      user: user._id,
      tenant: tenantId,
      expiresAt: refreshExpiry(),
      isRevoked: false,
    });

    return res.json({
      ok: true,
      user: { id: String(user._id), email: user.email, displayName: user.displayName },
      ispId: String(tenantId),
      accessToken,
      refreshToken: rawRefresh,
    });
  } catch (e) {
    console.error("login error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/* --------- refresh (ROTATION) --------- */
router.post("/refresh", async (req, res) => {
  try {
    const parsed = RefreshSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid payload" });

    const raw = parsed.data.refreshToken;
    const doc = await RefreshToken.findOne({ tokenHash: hashToken(raw) });
    if (!doc || doc.isRevoked) return res.status(401).json({ ok: false, error: "Invalid token" });
    if (Date.now() > new Date(doc.expiresAt).getTime()) {
      return res.status(401).json({ ok: false, error: "Expired token" });
    }

    const user = await User.findById(doc.user).lean();
    if (!user || user.isActive === false) {
      return res.status(401).json({ ok: false, error: "User disabled" });
    }

    // rotate: revoke old, mint new
    await RefreshToken.updateOne({ _id: doc._id }, { $set: { isRevoked: true } });
    const nextRaw = crypto.randomBytes(48).toString("base64url");
    await RefreshToken.create({
      tokenHash: hashToken(nextRaw),
      user: doc.user,
      tenant: doc.tenant,
      expiresAt: refreshExpiry(),
      isRevoked: false,
    });

    const accessToken = signAccessToken({ user, tenantId: doc.tenant });
    return res.json({
      ok: true,
      accessToken,
      refreshToken: nextRaw,
      ispId: String(doc.tenant),
      user: { id: String(user._id), email: user.email, displayName: user.displayName },
    });
  } catch (e) {
    console.error("refresh error:", e);
    return res.status(500).json({ ok: false, error: "Refresh failed" });
  }
});

/* --------- logout --------- */
router.post("/logout", async (req, res) => {
  try {
    const raw = req.body?.refreshToken;
    if (raw) {
      await RefreshToken.updateMany(
        { tokenHash: hashToken(raw) },
        { $set: { isRevoked: true } }
      );
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error("logout error:", e);
    return res.status(500).json({ ok: false, error: "Logout failed" });
  }
});

module.exports = router;
