'use strict';

const crypto = require('node:crypto');
const NetworkOperation = require('../models/NetworkOperation');
const NetworkAssignment = require('../models/NetworkAssignment');
const { sendCommand } = require('../utils/mikrotikConnectionManager');

const word = (key, value) => `=${key}=${value}`;
const MAX_ATTEMPTS = 8;

async function applyStaticAssignment(assignment, operation) {
  const tenantId = String(assignment.tenantId);
  const serverId = String(assignment.routerId);
  const ip = String(assignment.ipAddress || '').trim();
  if (!ip) throw new Error('Static assignment has no IP address');
  const name = `billing-${assignment._id}`;
  const target = ip.includes('/') ? ip : `${ip}/32`;
  const context = { tenantId, serverId, timeoutMs: 10000 };
  if (assignment.desiredState === 'absent' || assignment.status === 'released') {
    const rows = await sendCommand('/queue/simple/print', [word('name', name)], context);
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = row['.id'] || row.id || row.numbers;
      if (id) await sendCommand('/queue/simple/remove', [word('numbers', id)], context);
    }
    return { state: 'absent' };
  }
  const rows = await sendCommand('/queue/simple/print', [word('name', name)], context);
  const existing = Array.isArray(rows) ? rows[0] : null;
  if (existing) {
    const id = existing['.id'] || existing.id || existing.numbers;
    await sendCommand('/queue/simple/set', [word('numbers', id), word('target', target), word('comment', `Billing assignment ${assignment._id}`)], context);
  } else {
    await sendCommand('/queue/simple/add', [word('name', name), word('target', target), word('comment', `Billing assignment ${assignment._id}`)], context);
  }
  const verify = await sendCommand('/queue/simple/print', [word('name', name)], context);
  if (!Array.isArray(verify) || !verify.length) throw new Error('Router did not confirm static queue');
  return { state: assignment.desiredState === 'suspended' ? 'suspended' : 'present', queueName: name, target };
}

async function processNetworkOperations({ limit = 20, now = new Date() } = {}) {
  const summary = { completed: 0, retried: 0, failed: 0, unsupported: 0 };
  for (let index = 0; index < Math.min(limit, 100); index += 1) {
    const leaseToken = crypto.randomUUID();
    const operation = await NetworkOperation.findOneAndUpdate({ status: { $in: ['pending', 'processing'] }, nextAttemptAt: { $lte: now }, $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] }, { $set: { status: 'processing', leaseToken, leaseUntil: new Date(now.getTime() + 120000) }, $inc: { attempts: 1 } }, { sort: { nextAttemptAt: 1 }, new: true }).lean();
    if (!operation) break;
    const claim = { _id: operation._id, leaseToken };
    try {
      const assignment = await NetworkAssignment.findOne({ _id: operation.assignmentId, tenantId: operation.tenantId }).lean();
      if (!assignment) throw new Error('Network assignment no longer exists');
      if (assignment.accessType !== 'static') {
        await NetworkOperation.updateOne(claim, { $set: { status: 'failed', lastError: `${assignment.accessType} provisioning adapter is not enabled yet` }, $unset: { leaseUntil: 1, leaseToken: 1 } });
        summary.unsupported += 1;
        continue;
      }
      const observed = await applyStaticAssignment(assignment, operation);
      await NetworkOperation.updateOne(claim, { $set: { status: 'complete', observedState: observed, completedAt: new Date(), lastError: null }, $unset: { leaseUntil: 1, leaseToken: 1 } });
      await NetworkAssignment.updateOne({ _id: assignment._id, tenantId: assignment.tenantId }, { $set: { observedState: observed.state, status: observed.state === 'present' ? 'active' : assignment.status, lastSynchronizedAt: new Date(), lastError: null } });
      summary.completed += 1;
    } catch (error) {
      const failed = operation.attempts >= MAX_ATTEMPTS;
      await NetworkOperation.updateOne(claim, { $set: { status: failed ? 'dead-letter' : 'pending', nextAttemptAt: new Date(now.getTime() + Math.min(3600000, 1000 * 2 ** operation.attempts)), lastError: String(error?.message || error) }, $unset: { leaseUntil: 1, leaseToken: 1 } });
      await NetworkAssignment.updateOne({ _id: operation.assignmentId, tenantId: operation.tenantId }, { $set: { observedState: 'error', status: 'error', lastError: String(error?.message || error) } });
      summary[failed ? 'failed' : 'retried'] += 1;
    }
  }
  return summary;
}

module.exports = { processNetworkOperations, applyStaticAssignment };
