'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canManageInviteRole,
  canManageMemberRole,
  normalizeTeamRole,
  serializeInvite,
  TEAM_ROLES,
} = require('../services/teamAccessService');

test('normalizeTeamRole accepts only platform-supported tenant roles', () => {
  assert.deepEqual(TEAM_ROLES, ['owner', 'admin', 'operator']);
  assert.equal(normalizeTeamRole(' ADMIN '), 'admin');
  assert.throws(() => normalizeTeamRole('viewer'), /Role must be one of/);
});

test('team access policy lets owners manage all roles and admins manage operators only', () => {
  assert.equal(canManageInviteRole('owner', 'owner'), true);
  assert.equal(canManageInviteRole('owner', 'admin'), true);
  assert.equal(canManageInviteRole('admin', 'operator'), true);
  assert.equal(canManageInviteRole('admin', 'admin'), false);
  assert.equal(canManageMemberRole('admin', 'operator', 'operator'), true);
  assert.equal(canManageMemberRole('admin', 'admin', 'operator'), false);
  assert.equal(canManageMemberRole('operator', 'operator', 'operator'), false);
});

test('serializeInvite exposes code and computed expiry state for operator UI', () => {
  const invite = serializeInvite({
    _id: 'inv-1',
    email: 'new@example.com',
    role: 'operator',
    code: 'abc',
    expiresAt: new Date(Date.now() - 1000),
  });

  assert.equal(invite.email, 'new@example.com');
  assert.equal(invite.role, 'operator');
  assert.equal(invite.code, 'abc');
  assert.equal(invite.isExpired, true);
});
