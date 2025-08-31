// server/security/auth.js
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import RefreshToken from "../models/RefreshToken.js";
import Membership from "../models/Membership.js";
import User from "../models/User.js";

export function signAccessToken({ user, tenantId }) {
  // keep payload minimal
  return jwt.sign(
    { sub: String(user._id), email: user.email, ispId: String(tenantId) },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [, token] = header.split(" ");
  if (!token) return res.status(401).json({ ok: false, error: "Missing token" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET); // { sub, email, ispId, iat, exp }
    return next();
  } catch {
    return res.status(401).json({ ok: false, error: "Invalid or expired token" });
  }
}

export function requireTenant(req, res, next) {
  const tenantId = req.headers["x-isp-id"] || req.user?.ispId;
  if (!tenantId) return res.status(401).json({ ok: false, error: "Missing tenant" });
  req.tenantId = String(tenantId);
  return next();
}

export async function ensureMembership(userId, tenantId) {
  const m = await Membership.findOne({ user: userId, tenant: tenantId }).lean();
  return !!m;
}

export function refreshExpiry() {
  const days = Number(process.env.REFRESH_TTL_DAYS || 30);
  return new Date(Date.now() + days * 86400 * 1000);
}

export async function issueRefreshToken({ userId, tenantId }) {
  const token = crypto.randomBytes(48).toString("base64url");
  await RefreshToken.create({
    token,
    user: userId,
    tenant: tenantId,
    expiresAt: refreshExpiry(),
  });
  return token;
}

export async function revokeRefreshToken(token) {
  await RefreshToken.updateMany({ token }, { $set: { isRevoked: true } });
}

export async function rotateRefreshIfNeeded(token) {
  // Optional rotation placeholder — here we just bump updatedAt
  await RefreshToken.updateOne({ token }, { $set: { updatedAt: new Date() } });
}
