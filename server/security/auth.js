// server/routes/auth.js
import express from "express";
import bcrypt from "bcryptjs"; // if you hash passwords
import User from "../models/User.js";
import Membership from "../models/Membership.js";
import RefreshToken from "../models/RefreshToken.js";
import { signAccessToken, refreshExpiry } from "../security/auth.js";
import crypto from "node:crypto";

const router = express.Router();

// Utility: hash refresh tokens at rest (recommended)
function hashToken(t) {
  return crypto.createHash("sha256").update(t).digest("hex");
}

// LOGIN — no requireAuth here
router.post("/login", async (req, res) => {
  try {
    const { email, password, ispId } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    // if you store hashed passwords:
    const ok = await bcrypt.compare(password, user.passwordHash || "");
    if (!ok) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    // ensure membership when multitenant
    if (ispId) {
      const has = await Membership.findOne({ user: user._id, tenant: ispId });
      if (!has) return res.status(403).json({ ok: false, error: "No membership for tenant" });
    }

    const accessToken = signAccessToken({ user, tenantId: ispId });
    const rawRefresh = crypto.randomBytes(48).toString("base64url");
    await RefreshToken.create({
      tokenHash: hashToken(rawRefresh),   // store hash, not raw
      user: user._id,
      tenant: ispId,
      expiresAt: refreshExpiry(),
      isRevoked: false,
    });

    return res.json({
      ok: true,
      accessToken,
      refreshToken: rawRefresh,
      ispId,
      user: { id: user._id, email: user.email, displayName: user.displayName },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Login failed" });
  }
});

// REFRESH — no requireAuth here
router.post("/refresh", async (req, res) => {
  try {
    const raw = req.body?.refreshToken; // or read from cookie
    if (!raw) return res.status(401).json({ ok: false, error: "Missing refresh token" });

    const doc = await RefreshToken.findOne({ tokenHash: hashToken(raw) });
    if (!doc || doc.isRevoked) return res.status(401).json({ ok: false, error: "Invalid token" });
    if (Date.now() > new Date(doc.expiresAt).getTime()) {
      return res.status(401).json({ ok: false, error: "Expired token" });
    }

    // (Optional) re-check membership
    const membership = await Membership.findOne({ user: doc.user, tenant: doc.tenant });
    if (!membership) return res.status(403).json({ ok: false, error: "No membership for tenant" });

    // ROTATE: revoke old, mint new
    await RefreshToken.updateOne({ _id: doc._id }, { $set: { isRevoked: true } });
    const nextRaw = crypto.randomBytes(48).toString("base64url");
    await RefreshToken.create({
      tokenHash: hashToken(nextRaw),
      user: doc.user,
      tenant: doc.tenant,
      expiresAt: refreshExpiry(),
      isRevoked: false,
    });

    // New access
    const user = await User.findById(doc.user).lean();
    const accessToken = signAccessToken({ user, tenantId: doc.tenant });

    return res.json({
      ok: true,
      accessToken,
      refreshToken: nextRaw,
      ispId: String(doc.tenant),
      user: { id: String(user._id), email: user.email, displayName: user.displayName },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Refresh failed" });
  }
});

// LOGOUT — no requireAuth required; just revoke the presented refresh
router.post("/logout", async (req, res) => {
  try {
    const raw = req.body?.refreshToken;
    if (raw) {
      await RefreshToken.updateMany({ tokenHash: hashToken(raw) }, { $set: { isRevoked: true } });
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Logout failed" });
  }
});

export default router;
