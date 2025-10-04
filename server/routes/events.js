const express = require('express');
const router = express.Router();
const RouterEvent = require('../models/RouterEvent');

// GET /api/mikrotik/events?limit=100
router.get('/mikrotik/events', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const events = await RouterEvent.find({ tenantId: req.tenantId }).sort({ at: -1 }).limit(limit).lean();
    res.json(events);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load events' });
  }
});

module.exports = router;

