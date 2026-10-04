'use strict';
const crypto = require('node:crypto');
const Operation = require('../models/NetworkOperation');
const Assignment = require('../models/NetworkAssignment');
const State = require('../models/FupState');
const { financialTransaction } = require('./financialTransaction');
const { createFupEnforcer } = require('./fupEnforcementService');
const manager = require('../utils/mikrotikConnectionManager');
async function processFupOperations({ limit = 20, enforce: injected } = {}) {
  const summary = { completed: 0, retried: 0, failed: 0, superseded: 0 };
  for (let i = 0; i < Math.min(Math.max(limit, 1), 100); i++) {
    const now = new Date(), token = crypto.randomUUID();
    const op = await Operation.findOneAndUpdate({
      operationType: { $in: ['fup.apply', 'fup.restore'] }, status: { $in: ['pending', 'processing'] },
      nextAttemptAt: { $lte: now }, $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
    }, { $set: { status: 'processing', leaseToken: token, leaseUntil: new Date(+now + 180000) }, $inc: { attempts: 1 } }, { new: true, sort: { nextAttemptAt: 1 } }).lean();
    if (!op) break;
    const claim = { _id: op._id, leaseToken: token };
    const generation = op.desiredState?.generation;
    let held;
    try {
      held = await Assignment.findOneAndUpdate({
        _id: op.assignmentId, tenantId: op.tenantId,
        $or: [{ 'fup.leaseUntil': null }, { 'fup.leaseUntil': { $lte: now } }],
      }, { $set: { 'fup.leaseToken': token, 'fup.leaseUntil': new Date(+now + 180000) } }, { new: true }).lean();
      if (!held) {
        await Operation.updateOne(claim, { $set: { status: 'pending', nextAttemptAt: new Date(+now + 10000) }, $unset: { leaseUntil: 1, leaseToken: 1 }, $inc: { attempts: -1 } });
        continue;
      }
      if (!Number.isInteger(generation) || generation !== held.fup?.generation || held.status === 'released' || held.desiredState === 'absent') {
        await Operation.updateOne(claim, { $set: { status: 'complete', completedAt: now, observedState: { superseded: true } }, $unset: { leaseUntil: 1, leaseToken: 1 } });
        summary.superseded++; continue;
      }
      const enforce = injected || createFupEnforcer({ send: async (...args) => {
        // Renew and fence before every command, including verification reads.
        const lease = await Assignment.updateOne({ _id: held._id, tenantId: op.tenantId, 'fup.leaseToken': token, 'fup.generation': generation, status: { $ne: 'released' }, desiredState: { $ne: 'absent' } },
          { $set: { 'fup.leaseUntil': new Date(Date.now() + 180000) } });
        if (!lease.matchedCount) throw new Error('FUP policy changed while applying');
        await Operation.updateOne(claim, { $set: { leaseUntil: new Date(Date.now() + 180000) } });
        return manager.sendCommand(...args);
      } });
      const observed = await enforce(held, op);
      await financialTransaction(async () => {
        const updated = await Assignment.updateOne({ _id: held._id, tenantId: op.tenantId, 'fup.generation': generation, 'fup.leaseToken': token },
          { $set: { 'fup.applied': op.desiredState.fupState, 'fup.lastAppliedAt': new Date(), 'fup.lastError': null,
            ...(op.desiredState.fupState === 'normal' ? { 'fup.baseline': null } : {}) } });
        if (!updated.matchedCount) throw new Error('FUP target changed before confirmation');
        await Operation.updateOne(claim, { $set: { status: 'complete', completedAt: new Date(), observedState: observed, lastError: null }, $unset: { leaseUntil: 1, leaseToken: 1 } });
        await State.updateMany({ tenantId: op.tenantId, assignmentId: held._id, generation }, { $set: {
          enforcement: 'applied', lastError: null, [op.desiredState.fupState === 'normal' ? 'restoredAt' : 'appliedAt']: new Date(),
        } });
      });
      summary.completed++;
    } catch (cause) {
      const failed = op.attempts >= 8;
      const error = cause.fupSafe ? cause.message : 'FUP enforcement was not confirmed. Check the router, profile, or RADIUS integration and retry.';
      await Operation.updateOne(claim, { $set: { status: failed ? 'dead-letter' : 'pending', lastError: error, nextAttemptAt: new Date(Date.now() + Math.min(3600000, 1000 * 2 ** op.attempts)) }, $unset: { leaseUntil: 1, leaseToken: 1 } });
      await Assignment.updateOne({ _id: op.assignmentId, tenantId: op.tenantId, 'fup.generation': generation }, { $set: { 'fup.lastError': error } });
      await State.updateMany({ tenantId: op.tenantId, assignmentId: op.assignmentId, generation }, { $set: { enforcement: 'failed', lastError: error } });
      summary[failed ? 'failed' : 'retried']++;
    } finally {
      if (held) await Assignment.updateOne({ _id: held._id, 'fup.leaseToken': token }, { $unset: { 'fup.leaseToken': 1, 'fup.leaseUntil': 1 } });
    }
  }
  return summary;
}
module.exports = { processFupOperations };
