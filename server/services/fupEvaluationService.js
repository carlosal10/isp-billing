'use strict';
const crypto = require('node:crypto');
const FupPolicy = require('../models/FupPolicy');
const FupState = require('../models/FupState');
const FupNotice = require('../models/FupNotice');
const UsageEvent = require('../models/UsageEvent');
const Assignment = require('../models/NetworkAssignment');
const Operation = require('../models/NetworkOperation');
const { financialTransaction } = require('./financialTransaction');
const { periodBounds, classify, parsePolicy } = require('./fupRules');

async function evaluateFup({ tenantId, assignmentId, now = new Date() }) {
  await require('./usageEventMigrationService').backfillLegacyUsage(tenantId);
  return financialTransaction(async () => {
    const assignment = await Assignment.findOne({ _id: assignmentId, tenantId });
    if (!assignment) throw Object.assign(new Error('Assignment not found'), { statusCode: 404 });
    if (assignment.status === 'released' || assignment.desiredState === 'absent') return { skipped: true, reason: 'released' };
    const policy = assignment.fupPolicyId ? await FupPolicy.findOne({ _id: assignment.fupPolicyId, tenantId }).lean() : null;
    let bounds = { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end: now };
    let consumed = 0n, state = 'normal';
    if (policy?.enabled) {
      const { _id, tenantId: ignored, createdAt, updatedAt, ...values } = policy;
      const validated = parsePolicy(values);
      bounds = periodBounds(validated, now);
      const rows = await UsageEvent.find({ tenantId, assignmentId, occurredAt: { $gte: bounds.start, $lt: bounds.end } }).select('uploadBytes downloadBytes').lean();
      for (const row of rows) {
        if (validated.measurement !== 'download') consumed += BigInt(row.uploadBytes);
        if (validated.measurement !== 'upload') consumed += BigInt(row.downloadBytes);
      }
      state = classify(validated, consumed);
    }
    if (assignment.fup?.overrideUntil > now) state = 'overridden';
    const desired = ['throttled', 'blocked'].includes(state) ? state : 'normal';
    const target = { accessState: assignment.desiredState, fupState: desired, uploadRate: desired === 'throttled' ? policy.throttleUpload : null, downloadRate: desired === 'throttled' ? policy.throttleDownload : null };
    const signature = crypto.createHash('sha256').update(JSON.stringify(target)).digest('hex');
    const changed = assignment.fup?.signature !== signature;
    if (changed) {
      assignment.set('fup.generation', (assignment.fup?.generation || 0) + 1);
      assignment.set('fup.signature', signature);
      assignment.set('fup.desired', desired);
      await assignment.save();
    }
    const generation = assignment.fup?.generation || 0;
    const key = 'fup:' + assignmentId + ':' + generation;
    if (changed || assignment.fup?.applied !== desired) {
      await Operation.updateOne({ tenantId, idempotencyKey: key }, { $setOnInsert: {
        routerId: assignment.routerId, customerId: assignment.customerId, assignmentId,
        operationType: desired === 'normal' ? 'fup.restore' : 'fup.apply',
        idempotencyKey: key, desiredState: { ...target, generation }, status: 'pending',
      } }, { upsert: true });
    }
    if (policy) {
      const periodStart = policy.period === 'rolling-30d' ? new Date(0) : bounds.start;
      await FupState.findOneAndUpdate({ tenantId, assignmentId, periodStart }, { $set: {
        customerId: assignment.customerId, policyId: policy._id, periodEnd: bounds.end,
        consumedBytes: consumed.toString(), state, generation, lastEvaluatedAt: now,
        enforcement: assignment.fup?.applied === desired && !changed ? 'applied' : 'pending',
      } }, { upsert: true, new: true, runValidators: true });
      if (state !== 'normal') await FupNotice.updateOne({ tenantId, key: assignmentId + ':' + policy._id + ':' + periodStart.toISOString() + ':' + state }, {
        $setOnInsert: { assignmentId, customerId: assignment.customerId, state,
          message: 'Fair usage status: ' + state + '. Recorded usage: ' + consumed + ' bytes.' },
      }, { upsert: true });
    }
    return { state, desired, generation, consumedBytes: consumed.toString(), periodStart: bounds.start, periodEnd: bounds.end };
  });
}
async function evaluateAllFup() {
  let after, evaluated = 0, failed = 0;
  for (;;) {
    const query = { status: { $ne: 'released' }, $or: [{ fupPolicyId: { $ne: null } }, { 'fup.applied': { $in: ['throttled', 'blocked'] } }] };
    if (after) query._id = { $gt: after };
    const batch = await Assignment.find(query).sort({ _id: 1 }).limit(100).select('_id tenantId').lean();
    if (!batch.length) break;
    for (const a of batch) {
      try { await evaluateFup({ tenantId: a.tenantId, assignmentId: a._id }); evaluated++; }
      catch { failed++; }
    }
    after = batch.at(-1)._id;
  }
  return { evaluated, failed };
}
module.exports = { evaluateFup, evaluateAllFup };
