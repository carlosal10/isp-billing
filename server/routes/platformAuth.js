const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { z } = require("zod");
const PlatformAdmin = require("../models/PlatformAdmin");
const { signPlatformAccessToken } = require("../utils/jwt");
const requirePlatformAdmin = require("../middleware/requirePlatformAdmin");
const { loginLimiter, registrationLimiter } = require("../middleware/riskRateLimits");

const router = express.Router();

const RegisterSchema = z.object({
  email: z.string().email(),
  username: z.string().min(2),
  password: z.string().min(10),
  isSuper: z.boolean().optional(),
});
const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

function secretsMatch(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''));
  const expectedBuffer = Buffer.from(String(expected || ''));
  return actualBuffer.length > 0 &&
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

async function authorizePlatformRegistration(req, res, next) {
  try {
    const hasAdmins = await PlatformAdmin.exists({});
    if (!hasAdmins) {
      const expected = process.env.PLATFORM_BOOTSTRAP_TOKEN;
      const supplied = req.headers['x-platform-bootstrap-token'];
      if (!expected) {
        return res.status(503).json({ ok: false, error: 'Platform bootstrap is disabled' });
      }
      if (!secretsMatch(supplied, expected)) {
        return res.status(403).json({ ok: false, error: 'Invalid platform bootstrap token' });
      }
      req.platformBootstrap = true;
      return next();
    }

    return requirePlatformAdmin(req, res, () => {
      if (req.user?.isSuper !== true) {
        return res.status(403).json({ ok: false, error: 'Super administrator access required' });
      }
      return next();
    });
  } catch (error) {
    console.error('[platform-auth] registration authorization failed:', error?.message || error);
    return res.status(500).json({ ok: false, error: 'Platform registration authorization failed' });
  }
}

router.post("/register", registrationLimiter, authorizePlatformRegistration, async (req, res) => {
  try {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid payload" });
    const { email, username, password, isSuper } = parsed.data;

    const exists = await PlatformAdmin.findOne({ email }).lean();
    if (exists) return res.status(409).json({ ok: false, error: "Email already in use" });

    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await PlatformAdmin.create({
      email,
      username,
      passwordHash,
      isSuper: req.platformBootstrap === true ? true : Boolean(isSuper),
    });

    const token = signPlatformAccessToken({ admin });
    res.json({
      ok: true,
      token,
      user: {
        id: String(admin._id),
        email,
        username,
        displayName: username,
        role: "platform-admin",
        isSuper: Boolean(admin.isSuper),
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

router.post("/login", loginLimiter, async (req, res) => {
  try {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid payload" });

    const { email, password } = parsed.data;
    const admin = await PlatformAdmin.findOne({ email });
    if (!admin || admin.isActive === false) {
      return res.status(400).json({ ok: false, error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) return res.status(400).json({ ok: false, error: "Invalid credentials" });

    // A revocation invalidates all existing tokens. A successful password login
    // starts a fresh session generation for the still-active administrator.
    if (admin.revokedAt) {
      const nextVersion = Number(admin.sessionVersion || 0) + 1;
      await PlatformAdmin.updateOne(
        { _id: admin._id },
        { $set: { revokedAt: null, sessionVersion: nextVersion } }
      );
      admin.revokedAt = null;
      admin.sessionVersion = nextVersion;
    }

    const token = signPlatformAccessToken({ admin });
    res.json({
      ok: true,
      token,
      user: {
        id: String(admin._id),
        email: admin.email,
        username: admin.username,
        displayName: admin.username,
        role: "platform-admin",
        isSuper: Boolean(admin.isSuper),
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

router.get("/verify", requirePlatformAdmin, (req, res) => {
  res.json({ ok: true, user: req.user });
});

module.exports = router;
module.exports.authorizePlatformRegistration = authorizePlatformRegistration;
module.exports.secretsMatch = secretsMatch;
