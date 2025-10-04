const express = require('express');
const router = express.Router();
const DailyUsage = require('../models/UsageLog');
const { sendCommand } = require('../utils/mikrotikConnectionManager');

// Record snapshot for today (idempotent per day per tenant)
router.post('/record', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const now = new Date();
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    // Probe router for active sessions
    let ppp = [], hs = [];
    const serverId = req.headers['x-isp-server'] || req.query.serverId || null;
    try { ppp = await sendCommand('/ppp/active/print', [], { tenantId, timeoutMs: 8000, serverId }); } catch {}
    try { hs = await sendCommand('/ip/hotspot/active/print', [], { tenantId, timeoutMs: 8000, serverId }); } catch {}
    const count = (Array.isArray(ppp) ? ppp.length : 0) + (Array.isArray(hs) ? hs.length : 0);

    const updated = await DailyUsage.findOneAndUpdate(
      { tenantId, date: day },
      { $set: { activeUsersCount: count } },
      { new: true, upsert: true }
    ).lean();

    return res.json({ ok: true, date: updated.date, activeUsersCount: updated.activeUsersCount });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Failed to record usage' });
  }
});

// Fetch last N days of snapshots
router.get('/daily', async (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);
  try {
    const data = await DailyUsage.find({ tenantId: req.tenantId, date: { $gte: fromDate } })
      .sort({ date: 1 })
      .select('date activeUsersCount')
      .lean();
    res.json({ ok: true, items: data });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Failed to load usage' });
  }
});

module.exports = router;

