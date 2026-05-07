'use strict';

const express = require('express');
const requireRole = require('../middleware/requireRole');
const {
  getAuditSummary,
  listAuditActions,
  listAuditLogs,
} = require('../services/auditLogService');

const router = express.Router();

router.use(requireRole('owner', 'admin'));

router.get('/', async (req, res) => {
  try {
    const logs = await listAuditLogs(req.tenantId, req.query || {});
    return res.json(logs);
  } catch (err) {
    console.error('audit log list failed:', err);
    return res.status(500).json({ error: 'Failed to load audit logs' });
  }
});

router.get('/actions', async (req, res) => {
  try {
    const actions = await listAuditActions(req.tenantId, req.query || {});
    return res.json(actions);
  } catch (err) {
    console.error('audit action list failed:', err);
    return res.status(500).json({ error: 'Failed to load audit actions' });
  }
});

router.get('/summary', async (req, res) => {
  try {
    const summary = await getAuditSummary(req.tenantId, req.query || {});
    return res.json(summary);
  } catch (err) {
    console.error('audit summary failed:', err);
    return res.status(500).json({ error: 'Failed to load audit summary' });
  }
});

module.exports = router;
