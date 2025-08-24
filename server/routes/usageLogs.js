const express = require('express');
const router = express.Router();
const UsageLog = require('../models/UsageLog');

router.get('/pppoe/stats/active-daily', async (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);

  const data = await DailyUsage.find({ date: { $gte: fromDate } })
    .sort({ date: 1 })
    .select('date activeUsersCount');

  res.json(data);
});

router.get('/pppoe/stats/usage-trends', async (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);

  const data = await DailyUsage.find({ date: { $gte: fromDate } })
    .sort({ date: 1 })
    .select('date usagePerUser');

  res.json(data);
});

module.exports = router;

