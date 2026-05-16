'use strict';

const express = require('express');
const requireRole = require('../middleware/requireRole');
const { getTenantOpsHealth } = require('../services/opsHealthService');

const router = express.Router();

router.get('/summary', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const summary = await getTenantOpsHealth(req.tenantId);
    res.json(summary);
  } catch (err) {
    console.error('ops health summary error:', err);
    res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to load operations health' });
  }
});

module.exports = router;
