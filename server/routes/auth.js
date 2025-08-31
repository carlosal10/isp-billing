// server/routes/auth.js
import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcrypt";
import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import Membership from "../models/Membership.js";
import RefreshToken from "../models/RefreshToken.js";
import {
  ensureMembership,
  issueRefreshToken,
  refreshExpiry,
  requireAuth,
  revokeRefreshToken,
  rotateRefreshIfNeeded,
  signAccessToken,
} from "../security/auth.js";

const router = Router();

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1),
  tenantName: z.string().min(1),
});

router.post("/register", async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid payload" });

  const { email, password, displayName, tenantName } = parsed.data;

  const existing = await User.findOne({ email }).lean();
  if (existing) return res.status(409).json({ ok: false, error: "Email already exists" });

  const tenant = await Tenant.create({ name: tenantName });
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({
    email,
    passwordHash,
    displayName,
    primaryTenant: tenant._id,
  });
  await Membership.create({ user: user._id, tenant: tenant._id, role: "owner" });

  const accessToken = signAccessToken({ user, tenantId: tenant._id });
  const refreshToken = await issueRefreshToken({ userId: user._id, tenantId: tenant._id });

  return res.json({
    ok: true,
    user: { id: String(user._id), email: user.email, displayName: user.displayName },
    ispId: String(tenant._id),
    accessToken,
    refreshToken,
  });
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  ispId: z.string().optional(),
});

router.post("/login", async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid payload" });

  const { email, password, ispId } = parsed.data;
  const user = await User.findOne({ email });
  if (!user || !user.isActive) return res.status(401).json({ ok: false, error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ ok: false, error: "Invalid credentials" });

  // pick tenant context
  let tenantId = ispId || user.primaryTenant;
  if (!tenantId) {
    const first = await Membership.findOne({ user: user._id }).lean();
    tenantId = first?.tenant;
  }
  if (!tenantId) return res.status(400).json({ ok: false, error: "No tenant context" });

  const hasAccess = await ensureMembership(user._id, tenantId);
  if (!hasAccess) return res.status(403).json({ ok: false, error: "No access to tenant" });

  const accessToken = signAccessToken({ user, tenantId });
  const refreshToken = await issueRefreshToken({ userId: user._id, tenantId });

  return res.json({
    ok: true,
    user: { id: String(user._id), email: user.email, displayName: user.displayName },
    ispId: String(tenantId),
    accessToken,
    refreshToken,
  });
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

router.post("/refresh", async (req, res) => {
  const parsed = RefreshSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid payload" });

  const { refreshToken } = parsed.data;
  const rec = await RefreshToken.findOne({ token: refreshToken });
  if (!rec || rec.isRevoked || rec.expiresAt < new Date()) {
    return res.status(401).json({ ok: false, error: "Invalid refresh" });
  }

  const user = await User.findById(rec.user);
  if (!user || !user.isActive) return res.status(401).json({ ok: false, error: "User disabled" });

  const accessToken = signAccessToken({ user, tenantId: rec.tenant });

  // optional rotation: bump timestamp (or generate new token)
  await rotateRefreshIfNeeded(refreshToken);

  return res.json({ ok: true, accessToken });
});

router.post("/logout", async (req, res) => {
  const token = req.body?.refreshToken;
  if (token) await revokeRefreshToken(token).catch(() => {});
  res.json({ ok: true });
});

export default router;
