const express = require("express");
const crypto = require("crypto");
const { z } = require("zod");
const Invite = require("../models/Invite");
const User = require("../models/User");
const Membership = require("../models/Membership");
const RefreshToken = require("../models/RefreshToken");
const bcrypt = require("bcryptjs");
const { signTenantAccessToken } = require("../utils/jwt");
const requireAuth = require("../middleware/requireAuth");
const requireTenant = require("../middleware/requireTenant");
const requireRole = require("../middleware/requireRole");
const {
  createTeamInvite,
  listPendingInvites,
  revokeTeamInvite,
} = require("../services/teamAccessService");

const router = express.Router();

const CreateSchema = z.object({
  email: z.string().email(),
  role: z.enum(["owner", "admin", "operator"]).default("operator"),
  expiresInHours: z.number().int().min(1).max(168).optional(),
});

const AcceptSchema = z.object({
  code: z.string().min(16),
  displayName: z.string().min(1),
  password: z.string().min(8),
});

function protectedTenantAccess(req, res, next) {
  return requireAuth(req, res, (authErr) => {
    if (authErr) return next(authErr);
    return requireTenant(req, res, next);
  });
}

function requestActor(req) {
  return {
    id: String(req.user?.email || req.user?.sub || req.user?.id || req.user?._id || ""),
    userId: String(req.user?.sub || req.user?.id || req.user?._id || ""),
    email: req.user?.email || null,
    role: req.role || (req.user?.isPlatformAdmin ? "platform-admin" : null),
  };
}

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

router.get("/", protectedTenantAccess, requireRole("owner", "admin"), async (req, res) => {
  try {
    const invites = await listPendingInvites(req.tenantId);
    return res.json(invites);
  } catch (e) {
    console.error("invite list failed:", e);
    return res.status(500).json({ ok: false, error: "Failed to load invites" });
  }
});

router.post("/", protectedTenantAccess, requireRole("owner", "admin"), async (req, res) => {
  try {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid payload" });

    const invite = await createTeamInvite({
      tenantId: req.tenantId,
      payload: parsed.data,
      actor: requestActor(req),
    });

    return res.status(201).json({ ok: true, invite });
  } catch (e) {
    console.error("invite create failed:", e);
    return res.status(e?.statusCode || 500).json({ ok: false, error: e?.message || "Invite failed" });
  }
});

router.post("/accept", async (req, res) => {
  try {
    const parsed = AcceptSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid payload" });

    const { code, displayName, password } = parsed.data;
    const inv = await Invite.findOne({ code });
    if (!inv || inv.expiresAt < new Date() || inv.acceptedAt) {
      return res.status(400).json({ ok: false, error: "Invalid or expired invite" });
    }

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
    } else {
      if (!user.isActive) {
        return res.status(403).json({ ok: false, error: "Invited user is disabled" });
      }
      const ok = await bcrypt.compare(password, user.passwordHash || "");
      if (!ok) {
        return res.status(401).json({ ok: false, error: "Existing user password is incorrect" });
      }
    }

    await Membership.updateOne(
      { user: user._id, tenant: inv.tenant },
      { $setOnInsert: { role: inv.role } },
      { upsert: true }
    );

    await Invite.updateOne({ _id: inv._id }, { $set: { acceptedAt: new Date() } });

    const accessToken = signTenantAccessToken({ user, tenantId: inv.tenant });
    const refreshToken = await issueRefreshToken({ userId: user._id, tenantId: inv.tenant });

    return res.json({
      ok: true,
      user: { id: String(user._id), email: user.email, displayName: user.displayName, role: inv.role },
      ispId: String(inv.tenant),
      role: inv.role,
      accessToken,
      refreshToken,
    });
  } catch (e) {
    console.error("invite accept failed:", e);
    return res.status(500).json({ ok: false, error: "Accept failed" });
  }
});

router.delete("/:id", protectedTenantAccess, requireRole("owner", "admin"), async (req, res) => {
  try {
    const invite = await revokeTeamInvite({
      tenantId: req.tenantId,
      inviteId: req.params.id,
      actor: requestActor(req),
    });
    return res.json({ ok: true, invite });
  } catch (e) {
    console.error("invite revoke failed:", e);
    return res.status(e?.statusCode || 500).json({ ok: false, error: e?.message || "Failed to revoke invite" });
  }
});

module.exports = router;
