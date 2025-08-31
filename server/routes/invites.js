const express = require("express");
const crypto = require("crypto");
const { z } = require("zod");
const Invite = require("../models/Invite");
const User = require("../models/User");
const Membership = require("../models/Membership");
const bcrypt = require("bcrypt");
const { signTenantAccessToken } = require("../utils/jwt");

const router = express.Router();

const CreateSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "operator", "billing", "viewer"]).default("operator"),
  expiresInHours: z.number().int().min(1).max(168).optional(), // default 72h
});

const AcceptSchema = z.object({
  code: z.string().min(16),
  displayName: z.string().min(1),
  password: z.string().min(8),
});

// POST /api/invites (create)
router.post("/", async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const userId = req.user?.sub || req.user?.id;
    if (!tenantId || !userId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid payload" });

    const { email, role, expiresInHours } = parsed.data;
    const code = crypto.randomBytes(24).toString("base64url");
    const ttl = (expiresInHours ?? 72) * 3600 * 1000;

    const inv = await Invite.create({
      tenant: tenantId,
      email,
      role,
      code,
      expiresAt: new Date(Date.now() + ttl),
      invitedBy: userId,
    });

    // TODO: email the invite link to user (include code)
    res.json({ ok: true, code: inv.code, expiresAt: inv.expiresAt });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Invite failed" });
  }
});

// POST /api/invites/accept
router.post("/accept", async (req, res) => {
  try {
    const parsed = AcceptSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid payload" });

    const { code, displayName, password } = parsed.data;
    const inv = await Invite.findOne({ code });
    if (!inv || inv.expiresAt < new Date() || inv.acceptedAt) {
      return res.status(400).json({ ok: false, error: "Invalid or expired invite" });
    }

    // If the user exists, attach membership; else create user
    let user = await User.findOne({ email: inv.email });
    if (!user) {
      const passwordHash = await bcrypt.hash(password, 12);
      user = await User.create({
        email: inv.email,
        displayName,
        passwordHash,
        isActive: true,
        primaryTenant: inv.tenant,
      });
    }

    // Membership (idempotent)
    await Membership.updateOne(
      { user: user._id, tenant: inv.tenant },
      { $setOnInsert: { role: inv.role } },
      { upsert: true }
    );

    await Invite.updateOne({ _id: inv._id }, { $set: { acceptedAt: new Date() } });

    const accessToken = signTenantAccessToken({ user, tenantId: inv.tenant });
    // (Optional) Issue a refresh token if you want auto-login after accept.

    res.json({
      ok: true,
      user: { id: String(user._id), email: user.email, displayName: user.displayName },
      ispId: String(inv.tenant),
      accessToken,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Accept failed" });
  }
});

module.exports = router;
