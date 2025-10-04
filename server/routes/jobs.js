const express = require('express');
const router = express.Router();
const JobRun = require('../models/JobRun');

// GET /api/jobs/runs?name=expireStatic&limit=50
router.get('/jobs/runs', async (req, res) => {
  try {
    const q = {};
    if (req.query.name) q.name = String(req.query.name);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await JobRun.find(q).sort({ startedAt: -1 }).limit(limit).lean();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load job runs' });
  }
});

module.exports = router;

