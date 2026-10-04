'use strict';
const express = require('express');
const mongoose = require('mongoose');
const requireRole = require('../middleware/requireRole');
const UsageCounter = require('../models/UsageCounter');
const router = express.Router();
const validId = (value) => mongoose.isValidObjectId(value);
const dayStart = (value) => { const date = value ? new Date(value) : new Date(); if (Number.isNaN(date.getTime())) return null; return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); };
const dayEnd = (value) => { const start = dayStart(value); return start ? new Date(start.getTime() + 86400000) : null; };

router.get('/customer/:customerId', requireRole('any'), async (req, res) => {
  if (!validId(req.params.customerId)) return res.status(400).json({ ok: false, error: 'Invalid customer id' });
  const from = dayStart(req.query.from) || new Date(Date.now() - 30 * 86400000);
  const to = dayEnd(req.query.to) || new Date();
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
  const items = await UsageCounter.find({ tenantId: req.tenantId, customerId: req.params.customerId, bucketStart: { $gte: from, $lt: to } }).sort({ bucketStart: 1 }).limit(limit).lean();
  const totals = items.reduce((result, item) => ({ inputBytes: (BigInt(result.inputBytes) + BigInt(item.inputBytes || '0')).toString(), outputBytes: (BigInt(result.outputBytes) + BigInt(item.outputBytes || '0')).toString() }), { inputBytes: '0', outputBytes: '0' });
  res.json({ ok: true, from, to, totals, items });
});

router.get('/daily', requireRole('any'), async (req, res) => {
  const from = dayStart(req.query.from) || new Date(Date.now() - 7 * 86400000);
  const to = dayEnd(req.query.to) || new Date();
  const match = { tenantId: new mongoose.Types.ObjectId(req.tenantId), bucketStart: { $gte: from, $lt: to } };
  if (req.query.customerId && validId(req.query.customerId)) match.customerId = new mongoose.Types.ObjectId(req.query.customerId);
  const items = await UsageCounter.aggregate([{ $match: match }, { $group: { _id: '$bucketStart', inputBytes: { $push: '$inputBytes' }, outputBytes: { $push: '$outputBytes' }, sessions: { $sum: 1 } } }, { $sort: { _id: 1 } }]);
  const data = items.map((item) => ({ date: item._id, sessions: item.sessions, inputBytes: item.inputBytes.reduce((sum, value) => (BigInt(sum) + BigInt(value || '0')).toString(), '0'), outputBytes: item.outputBytes.reduce((sum, value) => (BigInt(sum) + BigInt(value || '0')).toString(), '0') }));
  res.json({ ok: true, from, to, items: data });
});

module.exports = router;
