'use strict';

const express = require('express');
const requireRole = require('../middleware/requireRole');
const {
  createIncident,
  getNocSummary,
  listIncidents,
  updateIncident,
} = require('../services/nocOperationsService');

const router = express.Router();

function requestActor(req) {
  return {
    id: String(req.user?.email || req.user?.sub || req.user?.id || req.user?._id || ''),
    email: req.user?.email || null,
    role: req.role || (req.user?.isPlatformAdmin ? 'platform-admin' : null),
  };
}

router.get('/summary', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const summary = await getNocSummary(req.tenantId);
    return res.json(summary);
  } catch (err) {
    console.error('noc summary error:', err);
    return res.status(500).json({ error: 'Failed to load NOC summary' });
  }
});

router.get('/incidents', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const incidents = await listIncidents(req.tenantId, req.query);
    return res.json(incidents);
  } catch (err) {
    console.error('noc incidents list error:', err);
    return res.status(500).json({ error: 'Failed to load NOC incidents' });
  }
});

router.post('/incidents', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const incident = await createIncident(req.tenantId, req.body, requestActor(req));
    return res.status(201).json({ ok: true, incident });
  } catch (err) {
    console.error('noc incident create error:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to create incident' });
  }
});

router.put('/incidents/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const incident = await updateIncident(req.tenantId, req.params.id, req.body, requestActor(req));
    return res.json({ ok: true, incident });
  } catch (err) {
    console.error('noc incident update error:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to update incident' });
  }
});

module.exports = router;
