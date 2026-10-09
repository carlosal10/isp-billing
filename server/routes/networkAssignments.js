'use strict';
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const requireRole = require('../middleware/requireRole');
const A = require('../models/NetworkAssignment');
const O = require('../models/NetworkOperation');
const Customer = require('../models/customers');
const Policy = require('../models/FupPolicy');
const Router = require('../models/MikrotikConnection');
const { encryptField } = require('../security/fieldEncryption');
const { financialTransaction: transaction } = require('../services/financialTransaction');
const { parseAssignment } = require('../services/networkAssignmentInput');
const validId = v => typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const actor = req => validId(req.user?.sub) ? req.user.sub : null;
function pageLimit(value, fallback = 100) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 500) throw fail(400, 'Limit must be between 1 and 500');
  return n;
}
async function policyExists(req, id) {
  if (id && (!validId(id) || !await Policy.exists({ _id: id, tenantId: req.tenantId }))) throw fail(400, 'Select a policy in this workspace');
}
async function queue(req, a, type) {
  return O.create({ tenantId: req.tenantId, routerId: a.routerId, customerId: a.customerId, assignmentId: a._id,
    operationType: type, idempotencyKey: 'assignment:' + a._id + ':' + new mongoose.Types.ObjectId(),
    desiredState: { status: a.desiredState }, actorId: actor(req) });
}
router.get('/', requireRole('any'), async (req, res) => {
  const filter = { tenantId: req.tenantId }, limit = pageLimit(req.query.limit);
  for (const key of ['customerId', 'routerId', 'after']) if (req.query[key] && !validId(req.query[key])) throw fail(400, 'Invalid ' + key);
  for (const key of ['customerId', 'routerId', 'accessType', 'status']) if (req.query[key]) filter[key] = req.query[key];
  if (req.query.after) filter._id = { $lt: req.query.after };
  const items = await A.find(filter).select('-fup.leaseToken').sort({ _id: -1 }).limit(limit + 1).lean();
  const more = items.length > limit; if (more) items.pop();
  res.json({ ok: true, items, nextCursor: more ? String(items.at(-1)._id) : null });
});
router.post('/', requireRole('owner', 'admin'), async (req, res) => {
  const input = parseAssignment(req.body);
  const result = await transaction(async () => {
    await policyExists(req, input.fupPolicyId);
    const customer = await Customer.findOne({ _id: input.customerId, tenantId: req.tenantId }).lean();
    // Serialize assignment creation per router, including duplicate username checks.
    const routerRecord = await Router.findOneAndUpdate({ _id: input.routerId, tenant: req.tenantId }, { $inc: { __v: 1 } });
    if (!customer || !routerRecord) throw fail(404, 'Customer or router not found in this workspace');
    if (input.accessType !== 'hotspot' && customer.connectionType !== input.accessType) throw fail(409, 'Customer connection type does not match this service');
    if (input.username && await A.exists({ tenantId: req.tenantId, routerId: input.routerId, accessType: input.accessType, username: input.username, status: { $ne: 'released' } })) throw fail(409, 'Username is already assigned on this router');
    const { password, ...fields } = input;
    const assignment = await A.create({ ...fields, tenantId: req.tenantId, status: 'provisioning', ...(password ? { provisioningPassword: encryptField(password) } : {}) });
    const operation = await queue(req, assignment, 'assignment.provision');
    return { assignment, operation };
  });
  res.status(201).json({ ok: true, ...result });
});
router.patch('/:id', requireRole('owner', 'admin'), async (req, res) => {
  if (!validId(req.params.id)) throw fail(400, 'Invalid assignment id');
  const body = req.body || {}, keys = Object.keys(body);
  if (!keys.length || keys.some(k => !['desiredState', 'fupPolicyId'].includes(k))) throw fail(400, 'Only requested access state and fair usage policy can be changed here');
  if ('desiredState' in body && !['present', 'suspended'].includes(body.desiredState)) throw fail(400, 'Choose present or suspended; use release to remove service');
  const assignment = await transaction(async () => {
    await policyExists(req, body.fupPolicyId);
    const a = await A.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!a) throw fail(404, 'Assignment not found');
    if (a.status === 'released' || a.desiredState === 'absent') throw fail(409, 'Released or releasing assignments cannot be changed');
    if (a.authenticationMode === 'radius' && 'desiredState' in body) throw fail(409, 'RADIUS lifecycle requires the external authorization adapter');
    Object.assign(a, body);
    if ('desiredState' in body) a.status = 'provisioning';
    await a.save();
    if ('desiredState' in body) await queue(req, a, 'assignment.reconcile');
    return a;
  });
  if ('fupPolicyId' in body) await require('../services/fupEvaluationService').evaluateFup({ tenantId: req.tenantId, assignmentId: assignment._id });
  res.json({ ok: true, assignment });
});
router.delete('/:id', requireRole('owner', 'admin'), async (req, res) => {
  if (!validId(req.params.id)) throw fail(400, 'Invalid assignment id');
  const assignment = await transaction(async () => {
    const a = await A.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!a) throw fail(404, 'Assignment not found');
    if (a.authenticationMode === 'radius') throw fail(409, 'RADIUS release requires the external authorization adapter');
    if (a.status === 'released' || a.desiredState === 'absent') return a;
    // Reserve username/IP until the router confirms removal.
    a.desiredState = 'absent'; a.status = 'provisioning';
    await a.save(); await queue(req, a, 'assignment.release');
    return a;
  });
  res.json({ ok: true, assignment });
});
router.get('/operations', requireRole('owner', 'admin'), async (req, res) => {
  const items = await O.find({ tenantId: req.tenantId }).sort({ createdAt: -1 }).limit(pageLimit(req.query.limit)).lean();
  res.json({ ok: true, items });
});
router.post('/operations/:id/retry', requireRole('owner', 'admin'), async (req, res) => {
  if (!validId(req.params.id)) throw fail(400, 'Invalid operation id');
  const operation = await O.findOneAndUpdate({ tenantId: req.tenantId, _id: req.params.id, status: { $in: ['failed', 'dead-letter'] } },
    { $set: { status: 'pending', attempts: 0, nextAttemptAt: new Date(), lastError: null }, $unset: { leaseUntil: 1, leaseToken: 1 } }, { new: true });
  if (!operation) throw fail(404, 'Retryable operation not found');
  res.json({ ok: true, operation });
});
router.use((error, req, res, next) => {
  if (error.code === 11000) return res.status(409).json({ error: 'An unreleased assignment already reserves this customer or IP address' });
  const status = error.statusCode || (['ValidationError', 'CastError'].includes(error.name) ? 400 : 500);
  res.status(status).json({ error: error.statusCode ? error.message : status === 400 ? 'Invalid network assignment settings' : 'Network request failed; retry or check server availability' });
});
module.exports = router;
