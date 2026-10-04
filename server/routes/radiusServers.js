'use strict';
const express = require('express');
const mongoose = require('mongoose');
const requireRole = require('../middleware/requireRole');
const RadiusServer = require('../models/RadiusServer');
const router = express.Router();
const validId = (value) => mongoose.isValidObjectId(value);
const actor = (req) => { const id = req.user?.sub || req.user?.id || req.user?._id; return validId(id) ? id : null; };

router.get('/', requireRole('owner', 'admin'), async (req, res) => {
  const items = await RadiusServer.find({ tenantId: req.tenantId }).select('-sharedSecret').sort({ name: 1 }).lean();
  res.json({ ok: true, items });
});

router.post('/', requireRole('owner', 'admin'), async (req, res) => {
  const { name, host, sharedSecret } = req.body || {};
  if (!name || !host || !sharedSecret) return res.status(400).json({ ok: false, error: 'name, host and sharedSecret are required' });
  try {
    const item = await RadiusServer.create({ ...req.body, tenantId: req.tenantId, createdBy: actor(req), updatedBy: actor(req) });
    const output = item.toObject(); delete output.sharedSecret;
    res.status(201).json({ ok: true, item: output });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ ok: false, error: 'A RADIUS server with this name already exists' });
    res.status(500).json({ ok: false, error: 'Failed to save RADIUS server' });
  }
});

router.patch('/:id', requireRole('owner', 'admin'), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ ok: false, error: 'Invalid RADIUS server id' });
  const allowed = ['name', 'host', 'authenticationPort', 'accountingPort', 'sharedSecret', 'protocol', 'timeoutMs', 'retries', 'interimAccountingInterval', 'enabled'];
  const update = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => allowed.includes(key)));
  update.updatedBy = actor(req);
  const item = await RadiusServer.findOneAndUpdate({ _id: req.params.id, tenantId: req.tenantId }, { $set: update }, { new: true, runValidators: true }).select('-sharedSecret');
  if (!item) return res.status(404).json({ ok: false, error: 'RADIUS server not found' });
  res.json({ ok: true, item });
});

router.delete('/:id', requireRole('owner', 'admin'), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ ok: false, error: 'Invalid RADIUS server id' });
  const result = await RadiusServer.deleteOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!result.deletedCount) return res.status(404).json({ ok: false, error: 'RADIUS server not found' });
  res.status(204).end();
});
module.exports = router;
