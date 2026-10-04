'use strict';
const Assignment = require('../models/NetworkAssignment');
const Operation = require('../models/NetworkOperation');
const Radius = require('../models/RadiusServer');
const { financialTransaction } = require('./financialTransaction');
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
async function radiusPolicy(tenantId, routerId, username) {
  if (!/^[a-f0-9]{24}$/i.test(routerId || '') || typeof username !== 'string' || !username || username.length > 128) throw fail(400, 'Router and username are required');
  const matches = await Assignment.find({ tenantId, routerId, username, authenticationMode: 'radius', status: { $ne: 'released' } }).limit(2).lean();
  if (matches.length !== 1) throw fail(409, 'A unique RADIUS assignment is required');
  const a = matches[0];
  const server = await Radius.findOne({ _id: a.radiusServerId, tenantId, enabled: true, fupIntegration: 'rest' }).lean();
  if (!server) throw fail(409, 'RADIUS FUP integration is not enabled');
  const op = await Operation.findOne({ tenantId, assignmentId: a._id, 'desiredState.generation': a.fup?.generation, operationType: { $in: ['fup.apply', 'fup.restore'] } }).lean();
  const state = a.fup?.desired || 'normal';
  const reject = a.desiredState !== 'present' || state === 'blocked';
  if (state === 'throttled' && !op) throw fail(409, 'Policy generation is not ready');
  return { assignmentId: String(a._id), generation: a.fup?.generation || 0,
    decision: reject ? 'reject' : 'continue', fupState: state,
    // Continue means apply the overlay AFTER normal credential and billing authorization.
    reply: state === 'throttled' ? { 'Mikrotik-Rate-Limit': op.desiredState.uploadRate + '/' + op.desiredState.downloadRate } : {},
    clearFupOverride: state === 'normal', operationId: op ? String(op._id) : null,
  };
}
async function acknowledgeRadiusPolicy(tenantId, assignmentId, generation) {
  if (!/^[a-f0-9]{24}$/i.test(assignmentId || '') || !Number.isInteger(generation) || generation < 1) throw fail(400, 'Invalid acknowledgment');
  return financialTransaction(async () => {
    const a = await Assignment.findOne({ _id: assignmentId, tenantId, authenticationMode: 'radius', 'fup.generation': generation });
    if (!a) throw fail(409, 'Policy acknowledgment is stale or assignment is missing');
    // Force a transaction conflict with any concurrent policy evaluation.
    a.set('fup.radiusAcknowledgedAt', new Date()); await a.save();
    const result = await Operation.updateOne({ tenantId, assignmentId, 'desiredState.generation': generation, operationType: { $in: ['fup.apply', 'fup.restore'] } }, {
      $set: { 'desiredState.radiusAcknowledged': true },
    });
    if (!result.matchedCount) throw fail(409, 'Operation missing');
    await Operation.updateOne({ tenantId, assignmentId, 'desiredState.generation': generation, status: { $in: ['dead-letter', 'failed', 'pending'] } }, { $set: { status: 'pending', attempts: 0, nextAttemptAt: new Date() } });
    return { ok: true };
  });
}
module.exports = { radiusPolicy, acknowledgeRadiusPolicy };
