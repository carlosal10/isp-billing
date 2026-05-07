'use strict';

const crypto = require('crypto');
const AuditLog = require('../models/AuditLog');
const Invite = require('../models/Invite');
const Membership = require('../models/Membership');
const User = require('../models/User');

const TEAM_ROLES = ['owner', 'admin', 'operator'];
const DEFAULT_INVITE_TTL_HOURS = 72;
const MAX_INVITE_TTL_HOURS = 168;

function serviceError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function actorId(actor = {}) {
  return String(actor.id || actor.email || actor.sub || actor._id || '').trim() || null;
}

function normalizeTeamRole(value, fallback = 'operator') {
  const role = String(value || fallback).trim().toLowerCase();
  if (!TEAM_ROLES.includes(role)) {
    throw serviceError(400, `Role must be one of: ${TEAM_ROLES.join(', ')}`);
  }
  return role;
}

function canManageInviteRole(callerRole, inviteRole) {
  if (callerRole === 'owner') return true;
  return callerRole === 'admin' && inviteRole === 'operator';
}

function canManageMemberRole(callerRole, targetRole, nextRole = null) {
  if (callerRole === 'owner') return true;
  if (callerRole !== 'admin') return false;
  return targetRole === 'operator' && (!nextRole || nextRole === 'operator');
}

function clampInviteTtlHours(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_INVITE_TTL_HOURS;
  return Math.min(Math.max(Math.floor(parsed), 1), MAX_INVITE_TTL_HOURS);
}

async function logAudit({ tenantId, actor, action, payload }) {
  if (!tenantId) return null;
  return AuditLog.create({
    tenantId,
    actor: actorId(actor),
    action,
    routerHost: null,
    payload,
  }).catch(() => null);
}

function serializeMember(membership = {}) {
  const user = membership.user || {};
  return {
    _id: String(membership._id),
    role: membership.role || 'operator',
    createdAt: membership.createdAt || null,
    updatedAt: membership.updatedAt || null,
    user: {
      _id: user._id ? String(user._id) : null,
      email: user.email || null,
      displayName: user.displayName || null,
      isActive: user.isActive !== false,
      createdAt: user.createdAt || null,
    },
  };
}

function serializeInvite(invite = {}) {
  return {
    _id: String(invite._id),
    email: invite.email || null,
    role: invite.role || 'operator',
    code: invite.code || null,
    expiresAt: invite.expiresAt || null,
    acceptedAt: invite.acceptedAt || null,
    createdAt: invite.createdAt || null,
    invitedBy: invite.invitedBy ? String(invite.invitedBy) : null,
    isExpired: invite.expiresAt ? invite.expiresAt < new Date() : false,
  };
}

async function listTeamMembers(tenantId) {
  const members = await Membership.find({ tenant: tenantId })
    .sort({ role: 1, createdAt: 1 })
    .populate('user', 'email displayName isActive createdAt')
    .lean();
  return members.map(serializeMember);
}

async function listPendingInvites(tenantId) {
  const invites = await Invite.find({
    tenant: tenantId,
    acceptedAt: { $exists: false },
    expiresAt: { $gte: new Date() },
  })
    .sort({ createdAt: -1 })
    .lean();
  return invites.map(serializeInvite);
}

async function ensureEmailNotAlreadyMember(tenantId, email) {
  const user = await User.findOne({ email }).select('_id email').lean();
  if (!user) return null;

  const membership = await Membership.findOne({ user: user._id, tenant: tenantId }).lean();
  if (membership) {
    throw serviceError(409, 'User is already a member of this tenant');
  }
  return user;
}

async function createTeamInvite({ tenantId, payload = {}, actor = {} }) {
  const email = String(payload.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw serviceError(400, 'A valid email is required');
  }
  const role = normalizeTeamRole(payload.role || 'operator');
  if (!canManageInviteRole(actor.role, role)) {
    throw serviceError(403, 'You cannot invite users with that role');
  }

  await ensureEmailNotAlreadyMember(tenantId, email);

  const expiresInHours = clampInviteTtlHours(payload.expiresInHours);
  const code = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + expiresInHours * 3600 * 1000);

  const invite = await Invite.create({
    tenant: tenantId,
    email,
    role,
    code,
    expiresAt,
    invitedBy: actor.userId || actor.id || null,
  });

  await logAudit({
    tenantId,
    actor,
    action: 'team.invite.create',
    payload: {
      inviteId: String(invite._id),
      email,
      role,
      expiresAt,
    },
  });

  return serializeInvite(invite);
}

async function revokeTeamInvite({ tenantId, inviteId, actor = {} }) {
  const invite = await Invite.findOne({ _id: inviteId, tenant: tenantId });
  if (!invite) throw serviceError(404, 'Invite not found');
  if (!canManageInviteRole(actor.role, invite.role)) {
    throw serviceError(403, 'You cannot revoke invites with that role');
  }

  await Invite.deleteOne({ _id: invite._id, tenant: tenantId });
  await logAudit({
    tenantId,
    actor,
    action: 'team.invite.revoke',
    payload: {
      inviteId: String(invite._id),
      email: invite.email || null,
      role: invite.role || null,
    },
  });

  return serializeInvite(invite);
}

async function countOwners(tenantId) {
  return Membership.countDocuments({ tenant: tenantId, role: 'owner' });
}

async function updateTeamMemberRole({ tenantId, membershipId, role, actor = {} }) {
  const nextRole = normalizeTeamRole(role);
  const membership = await Membership.findOne({ _id: membershipId, tenant: tenantId })
    .populate('user', 'email displayName isActive createdAt');
  if (!membership) throw serviceError(404, 'Team member not found');

  const previousRole = membership.role || 'operator';
  if (!canManageMemberRole(actor.role, previousRole, nextRole)) {
    throw serviceError(403, 'You cannot change this team member role');
  }

  if (previousRole === 'owner' && nextRole !== 'owner' && (await countOwners(tenantId)) <= 1) {
    throw serviceError(409, 'At least one owner must remain on the tenant');
  }

  membership.role = nextRole;
  await membership.save();

  await logAudit({
    tenantId,
    actor,
    action: 'team.member.role_update',
    payload: {
      membershipId: String(membership._id),
      userId: membership.user?._id ? String(membership.user._id) : null,
      email: membership.user?.email || null,
      previousRole,
      nextRole,
    },
  });

  return serializeMember(membership);
}

async function removeTeamMember({ tenantId, membershipId, actor = {} }) {
  const membership = await Membership.findOne({ _id: membershipId, tenant: tenantId })
    .populate('user', 'email displayName isActive createdAt');
  if (!membership) throw serviceError(404, 'Team member not found');

  const targetRole = membership.role || 'operator';
  if (!canManageMemberRole(actor.role, targetRole)) {
    throw serviceError(403, 'You cannot remove this team member');
  }
  if (String(membership.user?._id || membership.user) === String(actor.userId || actor.id || '')) {
    throw serviceError(409, 'You cannot remove your own active membership');
  }
  if (targetRole === 'owner' && (await countOwners(tenantId)) <= 1) {
    throw serviceError(409, 'At least one owner must remain on the tenant');
  }

  await Membership.deleteOne({ _id: membership._id, tenant: tenantId });
  await logAudit({
    tenantId,
    actor,
    action: 'team.member.remove',
    payload: {
      membershipId: String(membership._id),
      userId: membership.user?._id ? String(membership.user._id) : null,
      email: membership.user?.email || null,
      role: targetRole,
    },
  });

  return serializeMember(membership);
}

module.exports = {
  TEAM_ROLES,
  canManageInviteRole,
  canManageMemberRole,
  createTeamInvite,
  listPendingInvites,
  listTeamMembers,
  normalizeTeamRole,
  removeTeamMember,
  revokeTeamInvite,
  serializeInvite,
  serializeMember,
  updateTeamMemberRole,
};
