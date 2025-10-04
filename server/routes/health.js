const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { getStatus } = require('../utils/mikrotikConnectionManager');
const { getAll } = require('../utils/heartbeats');

// GET /api/health/detail (tenant-protected)
router.get('/detail', async (req, res) => {
  try {
    const mongo = mongoose.connection?.readyState === 1 ? 'up' : 'down';
    const tenantId = req.tenantId || null;
    const allRouters = getStatus();
    const routers = tenantId ? allRouters.filter(r => String(r.tenantId) === String(tenantId)) : [];
    const jobs = getAll();
    res.json({ ok: true, mongo, routers, jobs, uptime: process.uptime() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || 'health detail failed' });
  }
});

module.exports = router;

