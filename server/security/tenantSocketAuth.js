'use strict';

const Membership = require('../models/Membership');
const { verifyTenantAccessToken } = require('../utils/jwt');

function readSocketToken(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const bearer = /^Bearer\s+([^\s]+)$/i.exec(raw);
  if (bearer) return bearer[1];
  return /^\S+$/.test(raw) ? raw : null;
}

async function findMembership(userId, tenantId) {
  return Membership.findOne({ user: userId, tenant: tenantId })
    .select({ role: 1 })
    .lean();
}

async function authenticateTenantSocket(
  auth = {},
  { membershipLookup = findMembership, verifyToken = verifyTenantAccessToken } = {}
) {
  const token = readSocketToken(auth.token);
  if (!token) throw new Error('Missing access token');

  const claims = verifyToken(token);
  const tenantId = String(claims.ispId || '').trim();
  const userId = String(claims.sub || '').trim();
  if (!tenantId || !userId) throw new Error('Invalid tenant token claims');

  const requestedTenantId = String(auth.ispId || '').trim();
  if (requestedTenantId && requestedTenantId !== tenantId) {
    throw new Error('Tenant does not match access token');
  }

  const membership = await membershipLookup(userId, tenantId);
  if (!membership) throw new Error('Tenant membership required');

  return {
    authToken: token,
    membership,
    role: membership.role,
    tenantId,
    user: claims,
  };
}

module.exports = {
  authenticateTenantSocket,
  readSocketToken,
};
