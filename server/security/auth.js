// server/routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const User = require("../models/User");
const Membership = require("../models/Membership");
const RefreshToken = require("../models/RefreshToken");
const { signAccessToken, refreshExpiry } = require("../security/auth");

const router = express.Router();

// ---- utils ----
function hashToken(t) {
  return crypto.createHash("sha256").update(t).digest("hex");
}

async function resolveTenantIdForLogin(user, ispIdFromBody) {
  // preferred: provided by client
  if (ispIdFromBody) return ispIdFromBody;
  // fallback: user's primaryTenant
  if (user.primaryTenant) return user.primaryTenant;
  // last resort: first membership
  const m = await Membership.findOne({ user: user._id }).lean();
  return m?.tenant || null;
}

// ---- POST /api/auth/login ----
router.post("/login", async (req, res) => {
  try {
    const { email, password, ispId } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "Invalid payload" });
    }

    const user = await User.findOne({ email });
    if (!user || !user.isActive) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash || "");
    if (!ok) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    const tenantId = await resolveTenantIdForLogin(user, ispId);
    if (!tenantId) return res.status(400).json({ ok: false, error: "No tenant context" });

    const mem = await Membership.findOne({ user: user._id, tenant: tenantId }).lean();
    if (!mem) return res.status(403).json({ ok: false, error: "No membership for tenant" });

    const accessToken = signAccessToken({ user, tenantId });
    const rawRefresh = crypto.randomBytes(48).toString("base64url");
    await RefreshToken.create({
      tokenHash: hashToken(rawRefresh), // store hash only
      user: user._id,
      tenant: tenantId,
      expiresAt: refreshExpiry(),
      isRevoked: false,
    });

    return res.json({
      ok: true,
      accessToken,
      refreshToken: rawRefresh,
      ispId: String(tenantId),
      user: { id: String(user._id), email: user.email, displayName: user.displayName },
    });
  } catch (e) {
    console.error("login error:", e);
    return res.status(500).json({ ok: false, error: "Login failed" });
  }
});

// ---- POST /api/auth/refresh ----
// Public endpoint: do NOT protect with requireAuth
router.post("/refresh", async (req, res) => {
  try {
    const raw = req.body?.refreshToken;
    if (!raw) return res.status(401).json({ ok: false, error: "Missing refresh token" });

    const doc = await RefreshToken.findOne({ tokenHash: hashToken(raw) });
    if (!doc || doc.isRevoked) return res.status(401).json({ ok: false, error: "Invalid token" });
    if (Date.now() > new Date(doc.expiresAt).getTime()) {
      return res.status(401).json({ ok: false, error: "Expired token" });
    }

    const user = await User.findById(doc.user).lean();
    if (!user || user.isActive === false) {
      return res.status(401).json({ ok: false, error: "User disabled" });
    }

    // rotate refresh: revoke old, mint new
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

// ---- POST /api/auth/logout ----
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
