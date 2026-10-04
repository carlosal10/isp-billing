'use strict';
const express = require('express');
const mongoose = require('mongoose');
const requireRole = require('../middleware/requireRole');
const Policy = require('../models/FupPolicy');
const Assignment = require('../models/NetworkAssignment');
const State = require('../models/FupState');
const Notice = require('../models/FupNotice');
const Operation = require('../models/NetworkOperation');
const { parsePolicy } = require('../services/fupRules');
const { evaluateFup } = require('../services/fupEvaluationService');
const router = express.Router();
const id = value => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
const fields = ['name', 'includedBytes', 'period', 'measurement', 'warningPercent', 'throttlePercent', 'throttleDownload', 'throttleUpload', 'hardBlockPercent', 'resetTimezone', 'enabled'];
const clean = value => Object.fromEntries(fields.filter(k => value[k] !== undefined).map(k => [k, value[k]]));
router.get('/', requireRole('any'), async (req, res) => res.json({ ok: true, items: await Policy.find({ tenantId: req.tenantId }).sort({ name: 1 }).limit(500).lean() }));
router.post('/', requireRole('owner', 'admin'), async (req, res) => {
  const item = await Policy.create({ ...parsePolicy(req.body), tenantId: req.tenantId });
  res.status(201).json({ ok: true, item });
});
router.get('/status', requireRole('any'), async (req, res) => {
  const filter = { tenantId: req.tenantId };
  if (req.query.after) { if (!id(req.query.after)) return res.status(400).json({ error: 'Invalid cursor' }); filter._id = { $gt: req.query.after }; }
  const assignments = await Assignment.find(filter).sort({ _id: 1 }).limit(100).select('customerId username accessType status desiredState fupPolicyId fup').lean();
  const ids = assignments.map(a => a._id);
  const states = await State.find({ tenantId: req.tenantId, assignmentId: { $in: ids } }).sort({ lastEvaluatedAt: -1 }).limit(500).lean();
  const notices = await Notice.find({ tenantId: req.tenantId, acknowledgedAt: null }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ ok: true, assignments: assignments.map(a => {
    const { leaseToken, leaseUntil, baseline, signature, ...fup } = a.fup || {};
    return { ...a, fup, usage: states.find(s => String(s.assignmentId) === String(a._id)) || null };
  }), notices, nextCursor: assignments.length === 100 ? String(assignments.at(-1)._id) : null });
});
router.post('/notices/:id/acknowledge', requireRole('owner', 'admin'), async (req, res) => {
  if (!id(req.params.id)) return res.status(400).json({ error: 'Invalid notice ID' });
  const result = await Notice.updateOne({ _id: req.params.id, tenantId: req.tenantId }, { $set: { acknowledgedAt: new Date() } });
  res.status(result.matchedCount ? 200 : 404).json({ ok: !!result.matchedCount });
});
router.patch('/:id', requireRole('owner', 'admin'), async (req, res) => {
  if (!id(req.params.id)) return res.status(400).json({ error: 'Invalid policy ID' });
  const item = await Policy.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!item) return res.status(404).json({ error: 'FUP policy not found' });
  if (Object.keys(req.body).some(k => !fields.includes(k))) return res.status(400).json({ error: 'Unknown policy field' });
  Object.assign(item, parsePolicy({ ...clean(item.toObject()), ...req.body }));
  await item.save();
  res.json({ ok: true, item });
});
router.put('/assignments/:id', requireRole('owner', 'admin'), async (req, res) => {
  if (!id(req.params.id) || (req.body.policyId !== null && !id(req.body.policyId))) return res.status(400).json({ error: 'Valid assignment and policy IDs are required' });
  if (req.body.policyId && !await Policy.exists({ _id: req.body.policyId, tenantId: req.tenantId })) return res.status(404).json({ error: 'Policy not found' });
  const a = await Assignment.findOneAndUpdate({ _id: req.params.id, tenantId: req.tenantId, status: { $ne: 'released' } }, { $set: { fupPolicyId: req.body.policyId } }, { new: true });
  if (!a) return res.status(404).json({ error: 'Assignment not found' });
  res.json({ ok: true, result: await evaluateFup({ tenantId: req.tenantId, assignmentId: a._id }) });
});
router.post('/assignments/:id/evaluate', requireRole('owner', 'admin'), async (req, res) => {
  if (!id(req.params.id)) return res.status(400).json({ error: 'Invalid assignment ID' });
  res.json({ ok: true, result: await evaluateFup({ tenantId: req.tenantId, assignmentId: req.params.id }) });
});
router.post('/assignments/:id/override', requireRole('owner', 'admin'), async (req, res) => {
  if (!id(req.params.id)) return res.status(400).json({ error: 'Invalid assignment ID' });
  const until = req.body.until === null ? null : new Date(req.body.until);
  if (until !== null && (!Number.isFinite(+until) || +until <= Date.now() || +until > Date.now() + 30 * 86400000 || typeof req.body.reason !== 'string' || !req.body.reason.trim() || req.body.reason.length > 300)) return res.status(400).json({ error: 'Provide a reason and an expiry within 30 days' });
  const a = await Assignment.findOneAndUpdate({ _id: req.params.id, tenantId: req.tenantId }, { $set: { 'fup.overrideUntil': until, 'fup.overrideReason': until ? req.body.reason.trim() : null } }, { new: true });
  if (!a) return res.status(404).json({ error: 'Assignment not found' });
  await Notice.create({ tenantId: req.tenantId, assignmentId: a._id, customerId: a.customerId, key: 'override:' + new mongoose.Types.ObjectId(), state: 'override', message: until ? 'Override until ' + until.toISOString() + ': ' + req.body.reason.trim() : 'Override removed' });
  res.json({ ok: true, result: await evaluateFup({ tenantId: req.tenantId, assignmentId: a._id }) });
});
router.post('/assignments/:id/retry', requireRole('owner', 'admin'), async (req, res) => {
  if (!id(req.params.id)) return res.status(400).json({ error: 'Invalid assignment ID' });
  const a = await Assignment.findOne({ _id: req.params.id, tenantId: req.tenantId }).lean();
  if (!a) return res.status(404).json({ error: 'Assignment not found' });
  const result = await Operation.updateOne({ tenantId: req.tenantId, assignmentId: a._id, 'desiredState.generation': a.fup?.generation, operationType: { $in: ['fup.apply', 'fup.restore'] }, status: { $in: ['failed', 'dead-letter', 'pending'] } }, { $set: { status: 'pending', attempts: 0, nextAttemptAt: new Date(), lastError: null } });
  res.json({ ok: true, retried: !!result.matchedCount });
});
router.use((error, req, res, next) => {
  const status = error.code === 11000 ? 409 : error.statusCode || (error.name === 'ValidationError' ? 400 : 500);
  res.status(status).json({ ok: false, error: status === 500 ? 'FUP request failed' : error.code === 11000 ? 'Policy name already exists' : error.message });
});
module.exports = router;
