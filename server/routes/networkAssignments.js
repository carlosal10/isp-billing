'use strict';

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const requireRole = require('../middleware/requireRole');
const NetworkAssignment = require('../models/NetworkAssignment');
const NetworkOperation = require('../models/NetworkOperation');
const Customer = require('../models/customers');
const MikroTikConnection = require('../models/MikrotikConnection');

function tenantFilter(req, extra = {}) { return { tenantId: req.tenantId, ...extra }; }
function validId(value) { return mongoose.isValidObjectId(value); }
function actorId(req) {
  const value = req.user?.sub || req.user?.id || req.user?._id;
  return validId(value) ? value : null;
}

router.get('/', requireRole('any'), async (req, res) => {
  const filter = tenantFilter(req);
  if (req.query.customerId && validId(req.query.customerId)) filter.customerId = req.query.customerId;
  if (req.query.routerId && validId(req.query.routerId)) filter.routerId = req.query.routerId;
  if (req.query.accessType) filter.accessType = req.query.accessType;
  if (req.query.status) filter.status = req.query.status;
  const items = await NetworkAssignment.find(filter).sort({ updatedAt: -1 }).lean();
  res.json({ ok: true, items });
});

router.post('/', requireRole('owner', 'admin'), async (req, res) => {
  const { customerId, routerId, accessType } = req.body || {};
  if (![customerId, routerId, accessType].every(Boolean) || !validId(customerId) || !validId(routerId)) {
    return res.status(400).json({ ok: false, error: 'customerId, routerId and a valid accessType are required' });
  }
  if (!['pppoe', 'static', 'hotspot'].includes(accessType)) return res.status(400).json({ ok: false, error: 'Unsupported accessType' });
  try {
    const [customer, routerRecord] = await Promise.all([
      Customer.findOne({ _id: customerId, tenantId: req.tenantId }).select('_id connectionType').lean(),
      MikroTikConnection.findOne({ _id: routerId, tenant: req.tenantId }).select('_id').lean(),
    ]);
    if (!customer) return res.status(404).json({ ok: false, error: 'Customer was not found in this tenant' });
    if (!routerRecord) return res.status(404).json({ ok: false, error: 'Router was not found in this tenant' });
    if (accessType !== 'hotspot' && customer.connectionType !== accessType) {
      return res.status(409).json({ ok: false, error: `Customer connection type is ${customer.connectionType}; it cannot receive a ${accessType} assignment` });
    }
    const assignment = await NetworkAssignment.create({ ...req.body, tenantId: req.tenantId, customerId, routerId, accessType });
    const operation = await NetworkOperation.create({
      tenantId: req.tenantId, routerId, customerId, assignmentId: assignment._id,
      operationType: 'assignment.provision', idempotencyKey: `assignment:${assignment._id}:provision`,
      desiredState: { accessType, status: assignment.desiredState }, actorId: actorId(req),
    });
    res.status(201).json({ ok: true, assignment, operation });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ ok: false, error: 'An active assignment already exists for this customer, router, or IP address' });
    res.status(500).json({ ok: false, error: 'Failed to create network assignment' });
  }
});

router.patch('/:id', requireRole('owner', 'admin'), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ ok: false, error: 'Invalid assignment id' });
  const allowed = ['status', 'desiredState', 'username', 'ipAddress', 'macAddress', 'vlanId', 'profileId', 'policyId', 'fupPolicyId', 'metadata', 'authenticationMode', 'radiusServerId', 'pppProfile'];
  const update = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => allowed.includes(key)));
  const assignment = await NetworkAssignment.findOneAndUpdate(tenantFilter(req, { _id: req.params.id }), { $set: update }, { new: true, runValidators: true });
  if (!assignment) return res.status(404).json({ ok: false, error: 'Assignment not found' });
  if (Object.keys(update).some((key) => ['status', 'desiredState', 'username', 'ipAddress', 'policyId'].includes(key))) {
    await NetworkOperation.create({ tenantId: req.tenantId, routerId: assignment.routerId, customerId: assignment.customerId, assignmentId: assignment._id, operationType: 'assignment.reconcile', idempotencyKey: `assignment:${assignment._id}:reconcile:${assignment.updatedAt.getTime()}`, desiredState: update, actorId: actorId(req) });
  }
  res.json({ ok: true, assignment });
});

router.delete('/:id', requireRole('owner', 'admin'), async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ ok: false, error: 'Invalid assignment id' });
  const assignment = await NetworkAssignment.findOneAndUpdate(
    tenantFilter(req, { _id: req.params.id, status: { $ne: 'released' } }),
    { $set: { status: 'released', desiredState: 'absent', releasedAt: new Date() } }, { new: true }
  );
  if (!assignment) return res.status(404).json({ ok: false, error: 'Assignment not found' });
  await NetworkOperation.create({ tenantId: req.tenantId, routerId: assignment.routerId, customerId: assignment.customerId, assignmentId: assignment._id, operationType: 'assignment.release', idempotencyKey: `assignment:${assignment._id}:release:${assignment.updatedAt.getTime()}`, desiredState: { status: 'released' }, actorId: actorId(req) });
  res.json({ ok: true, assignment });
});

router.get('/operations', requireRole('owner', 'admin'), async (req, res) => {
  const items = await NetworkOperation.find(tenantFilter(req)).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit) || 100, 500)).lean();
  res.json({ ok: true, items });
});

module.exports = router;
