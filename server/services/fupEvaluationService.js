'use strict';
const FupPolicy = require('../models/FupPolicy');
const FupState = require('../models/FupState');
const UsageCounter = require('../models/UsageCounter');
const NetworkAssignment = require('../models/NetworkAssignment');
const NetworkOperation = require('../models/NetworkOperation');

async function evaluateFup({ tenantId, assignmentId, now = new Date() }) {
  const assignment = await NetworkAssignment.findOne({ _id: assignmentId, tenantId }).lean();
  if (!assignment?.fupPolicyId) return { skipped: true, reason: 'no-policy' };
  const policy = await FupPolicy.findOne({ _id: assignment.fupPolicyId, tenantId, enabled: true }).lean();
  if (!policy) return { skipped: true, reason: 'policy-not-found' };
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const rows = await UsageCounter.find({ tenantId, assignmentId, bucketStart: { $gte: start, $lt: end } }).select('inputBytes outputBytes').lean();
  const consumed = rows.reduce((sum, row) => sum + BigInt(row.inputBytes || '0') + BigInt(row.outputBytes || '0'), 0n);
  const included = BigInt(policy.includedBytes);
  const percent = included === 0n ? 10000 : Number((consumed * 10000n) / included) / 100;
  const nextState = policy.hardBlockPercent && percent >= policy.hardBlockPercent ? 'blocked' : percent >= policy.throttlePercent ? 'throttled' : percent >= policy.warningPercent ? 'warned' : 'normal';
  const state = await FupState.findOneAndUpdate({ tenantId, assignmentId, periodStart: start }, { $set: { customerId: assignment.customerId, policyId: policy._id, periodEnd: end, consumedBytes: consumed.toString(), state: nextState, lastEvaluatedAt: now, ...(nextState === 'throttled' || nextState === 'blocked' ? { appliedAt: now } : {}) } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  if (nextState === 'throttled' || nextState === 'blocked') {
    const key = `fup:${assignmentId}:${start.toISOString()}:${nextState}`;
    await NetworkOperation.updateOne({ tenantId, idempotencyKey: key }, { $setOnInsert: { routerId: assignment.routerId, customerId: assignment.customerId, assignmentId, operationType: 'fup.apply', idempotencyKey: key, desiredState: { fupState: nextState, downloadRate: policy.throttleDownload, uploadRate: policy.throttleUpload }, status: 'pending' } }, { upsert: true });
  }
  return { state: state.state, consumedBytes: state.consumedBytes, percent };
}
module.exports = { evaluateFup };
