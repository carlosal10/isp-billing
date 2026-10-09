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
const { effectiveState, isBillable } = require('../services/subscriberAccessService');
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
  await require('../models/AuditLog').create({ tenantId: req.tenantId, actor: actor(req), action: type,
    payload: { assignmentId: a._id, customerId: a.customerId, routerId: a.routerId, desiredState: a.desiredState } });
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
    const customer = await Customer.findOneAndUpdate({ _id: input.customerId, tenantId: req.tenantId, status: { $ne: 'archived' } }, { $inc: { __v: 1 } });
    // Serialize assignment creation per router, including duplicate username checks.
    const routerRecord = await Router.findOneAndUpdate({ _id: input.routerId, tenant: req.tenantId }, { $inc: { __v: 1 } });
    if (!customer || !routerRecord) throw fail(404, 'Customer or router not found in this workspace');
    if (input.accessType !== 'hotspot' && customer.connectionType !== input.accessType) throw fail(409, 'Customer connection type does not match this service');
    if (input.username && await A.exists({ tenantId: req.tenantId, routerId: input.routerId, accessType: input.accessType, username: input.username, status: { $ne: 'released' } })) throw fail(409, 'Username is already assigned on this router');
    const { password, ...fields } = input;
    const billingState = isBillable(customer) ? 'allowed' : 'blocked';
    const assignment = await A.create({ ...fields, tenantId: req.tenantId, status: 'provisioning', manualState: 'present', billingState,
      desiredState: billingState === 'allowed' ? 'present' : 'suspended', credentialVersion: password ? 1 : 0,
      ...(password ? { provisioningPassword: encryptField(password) } : {}) });
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
    if ('fupPolicyId' in body) a.fupPolicyId = body.fupPolicyId;
    if ('desiredState' in body) { a.manualState = body.desiredState; a.desiredState = effectiveState(a); a.accessRevision++; a.status = 'provisioning'; }
    await a.save();
    if ('desiredState' in body) await queue(req, a, 'assignment.reconcile');
    return a;
  });
  if ('fupPolicyId' in body) await require('../services/fupEvaluationService').evaluateFup({ tenantId: req.tenantId, assignmentId: assignment._id });
  res.json({ ok: true, assignment });
});
router.get('/discover/pppoe', requireRole('owner', 'admin'), async (req, res) => {
  if (!validId(req.query.routerId)) throw fail(400, 'Select a router');
  if (!await Router.exists({ _id: req.query.routerId, tenant: req.tenantId })) throw fail(404, 'Router not found');
  const rows = await require('../utils/mikrotikConnectionManager').sendCommand('/ppp/secret/print', [], { tenantId: req.tenantId, serverId: req.query.routerId });
  const reserved = await A.find({ tenantId: req.tenantId, routerId: req.query.routerId, accessType: 'pppoe', status: { $ne: 'released' } }).select('username').lean();
  const names = new Set(reserved.map(a => a.username));
  const candidates = rows.filter(r => ['pppoe', 'any'].includes(r.service) && !names.has(r.name) && !String(r.comment || '').startsWith('billing-assignment:'));
  res.json({ items: candidates.map(r => ({ username: r.name, profile: r.profile, disabled: ['yes', 'true', true].includes(r.disabled) })) });
});
router.post('/link', requireRole('owner', 'admin'), async (req, res) => {
  const { customerId, routerId, username } = req.body || {};
  if (!validId(customerId) || !validId(routerId) || typeof username !== 'string' || !username.trim() || username.length > 128 || /[\x00-\x1f\x7f]/.test(username)) throw fail(400, 'Select a customer, router and existing PPPoE account');
  if (!await Router.exists({ _id: routerId, tenant: req.tenantId })) throw fail(404, 'Router not found');
  const rows = await require('../utils/mikrotikConnectionManager').sendCommand('/ppp/secret/print', ['?name=' + username.trim()], { tenantId: req.tenantId, serverId: routerId });
  const row = rows.find(r => r.name === username.trim() && ['pppoe', 'any'].includes(r.service));
  if (!row?.['.id'] || rows.length !== 1 || String(row.comment || '').startsWith('billing-assignment:')) throw fail(409, 'Account is missing, ambiguous or already managed');
  const result = await transaction(async () => {
    const c = await Customer.findOneAndUpdate({ _id: customerId, tenantId: req.tenantId, connectionType: 'pppoe', status: { $ne: 'archived' } }, { $inc: { __v: 1 } });
    const r = await Router.findOneAndUpdate({ _id: routerId, tenant: req.tenantId }, { $inc: { __v: 1 } });
    if (!c || !r) throw fail(404, 'Customer or router not found');
    if (await A.exists({ tenantId: req.tenantId, routerId, accessType: 'pppoe', username: row.name, status: { $ne: 'released' } })) throw fail(409, 'Account already assigned');
    const billingState = isBillable(c) ? 'allowed' : 'blocked';
    const manualState = ['yes', 'true', true].includes(row.disabled) ? 'suspended' : 'present';
    const assignment = new A({ tenantId: req.tenantId, customerId, routerId, accessType: 'pppoe', username: row.name, pppProfile: row.profile,
      provisioningMode: 'link', linkedAccount: { routerId: row['.id'], originalComment: row.comment || '' }, billingState, manualState, status: 'provisioning' });
    assignment.desiredState = effectiveState(assignment); await assignment.save();
    const operation = await queue(req, assignment, 'assignment.provision');
    return { assignment, operation };
  });
  res.status(201).json({ ok: true, ...result });
});
router.post('/:id/password', requireRole('owner', 'admin'), async (req, res) => {
  if (!validId(req.params.id) || typeof req.body?.password !== 'string' || req.body.password.length < 8 || req.body.password.length > 128 || /[\x00-\x1f\x7f]/.test(req.body.password)) throw fail(400, 'Use a password of 8–128 characters');
  await transaction(async () => {
    const a = await A.findOne({ _id: req.params.id, tenantId: req.tenantId, accessType: 'pppoe', authenticationMode: 'local', status: { $ne: 'released' }, desiredState: { $ne: 'absent' } });
    if (!a) throw fail(404, 'Editable local PPPoE service not found');
    a.provisioningPassword = encryptField(req.body.password); a.credentialVersion++; a.accessRevision++; a.status = 'provisioning';
    await a.save(); await queue(req, a, 'assignment.reconcile');
  });
  res.json({ ok: true, message: 'Credential update queued; existing sessions keep their connection until reconnect.' });
});
router.delete('/:id', requireRole('owner', 'admin'), async (req, res) => {
  if (!validId(req.params.id)) throw fail(400, 'Invalid assignment id');
  const assignment = await transaction(async () => {
    const a = await A.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!a) throw fail(404, 'Assignment not found');
    if (a.authenticationMode === 'radius') throw fail(409, 'RADIUS release requires the external authorization adapter');
    if (a.status === 'released' || a.desiredState === 'absent') return a;
    // Reserve username/IP until the router confirms removal.
    a.desiredState = 'absent'; a.accessRevision++; a.status = 'provisioning';
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
