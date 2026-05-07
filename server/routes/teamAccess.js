'use strict';

const express = require('express');
const requireRole = require('../middleware/requireRole');
const {
  listTeamMembers,
  removeTeamMember,
  updateTeamMemberRole,
} = require('../services/teamAccessService');

const router = express.Router();

function requestActor(req) {
  return {
    id: String(req.user?.email || req.user?.sub || req.user?.id || req.user?._id || ''),
    userId: String(req.user?.sub || req.user?.id || req.user?._id || ''),
    email: req.user?.email || null,
    role: req.role || (req.user?.isPlatformAdmin ? 'platform-admin' : null),
  };
}

router.use(requireRole('owner', 'admin'));

router.get('/members', async (req, res) => {
  try {
    const members = await listTeamMembers(req.tenantId);
    return res.json(members);
  } catch (err) {
    console.error('team member list failed:', err);
    return res.status(500).json({ error: 'Failed to load team members' });
  }
});

router.patch('/members/:id/role', async (req, res) => {
  try {
    const member = await updateTeamMemberRole({
      tenantId: req.tenantId,
      membershipId: req.params.id,
      role: req.body?.role,
      actor: requestActor(req),
    });
    return res.json({ ok: true, member });
  } catch (err) {
    console.error('team member role update failed:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to update team member role' });
  }
});

router.delete('/members/:id', async (req, res) => {
  try {
    const member = await removeTeamMember({
      tenantId: req.tenantId,
      membershipId: req.params.id,
      actor: requestActor(req),
    });
    return res.json({ ok: true, member });
  } catch (err) {
    console.error('team member remove failed:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to remove team member' });
  }
});

module.exports = router;
