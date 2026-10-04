'use strict';
const express = require('express');
const requireRole = require('../middleware/requireRole');
const FupPolicy = require('../models/FupPolicy');
const router = express.Router();
router.get('/', requireRole('any'), async (req, res) => res.json({ ok: true, items: await FupPolicy.find({ tenantId: req.tenantId }).sort({ name: 1 }).lean() }));
router.post('/', requireRole('owner', 'admin'), async (req, res) => {
  try { const item = await FupPolicy.create({ ...req.body, tenantId: req.tenantId }); return res.status(201).json({ ok: true, item }); }
  catch (error) { if (error?.code === 11000) return res.status(409).json({ ok: false, error: 'A policy with this name already exists' }); return res.status(400).json({ ok: false, error: 'Invalid FUP policy' }); }
});
router.patch('/:id', requireRole('owner', 'admin'), async (req, res) => { const allowed = ['name', 'includedBytes', 'period', 'warningPercent', 'throttlePercent', 'throttleDownload', 'throttleUpload', 'hardBlockPercent', 'resetTimezone', 'enabled']; const update = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => allowed.includes(key))); const item = await FupPolicy.findOneAndUpdate({ _id: req.params.id, tenantId: req.tenantId }, { $set: update }, { new: true, runValidators: true }); if (!item) return res.status(404).json({ ok: false, error: 'FUP policy not found' }); res.json({ ok: true, item }); });
module.exports = router;
