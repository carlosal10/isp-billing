'use strict';

const crypto = require('node:crypto');
const NetworkOperation = require('../models/NetworkOperation');
const NetworkAssignment = require('../models/NetworkAssignment');
const RadiusServer = require('../models/RadiusServer');
const { decryptField } = require('../security/fieldEncryption');
const { sendCommand } = require('../utils/mikrotikConnectionManager');
const { createPppoeService } = require('./pppoeService');

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
  const fupRate = operation?.operationType === 'fup.apply' ? `${operation.desiredState?.downloadRate || '2M'}/${operation.desiredState?.uploadRate || '512K'}` : operation?.operationType === 'fup.restore' ? operation.desiredState?.restoreRate : null;
  if (assignment.desiredState === 'absent' || assignment.status === 'released') {
    const rows = await sendCommand('/queue/simple/print', ['?name=' + name], context);
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = row['.id'] || row.id || row.numbers;
      if (id) await sendCommand('/queue/simple/remove', [word('numbers', id)], context);
    }
    return { state: 'absent' };
  }
  const rows = await sendCommand('/queue/simple/print', ['?name=' + name], context);
  const existing = Array.isArray(rows) ? rows[0] : null;
  if (existing) {
    const id = existing['.id'] || existing.id || existing.numbers;
    const words = [word('numbers', id), word('target', target), word('comment', `Billing assignment ${assignment._id}`)]; if (fupRate) words.push(word('max-limit', fupRate)); await sendCommand('/queue/simple/set', words, context);
  } else {
    const words = [word('name', name), word('target', target), word('comment', `Billing assignment ${assignment._id}`)]; if (fupRate) words.push(word('max-limit', fupRate)); await sendCommand('/queue/simple/add', words, context);
  }
  const verify = await sendCommand('/queue/simple/print', ['?name=' + name], context);
  if (!Array.isArray(verify) || !verify.length) throw new Error('Router did not confirm static queue');
  return { state: assignment.desiredState === 'suspended' ? 'suspended' : 'present', queueName: name, target };
}

async function applyPppoeAssignment(assignment) {
  const username = String(assignment.username || '').trim();
  if (!username) throw new Error('PPPoE assignment has no username');
  const service = createPppoeService();
  const context = { tenantId: String(assignment.tenantId), serverId: String(assignment.routerId) };
  if (assignment.desiredState === 'absent' || assignment.status === 'released') {
    await service.remove(context, username);
    return { state: 'absent', username };
  }
  const result = await service.setEnabled(context, [username], assignment.desiredState !== 'suspended' && assignment.fup?.desired !== 'blocked');
  return { state: assignment.desiredState === 'suspended' ? 'suspended' : 'present', username, verified: result.verified };
}

async function configureRadiusForAssignment(assignment) {
  if (assignment.authenticationMode !== 'radius') throw new Error('RADIUS operation requires authenticationMode=radius');
  if (!assignment.radiusServerId) throw new Error('RADIUS assignment has no radiusServerId');
  const radius = await RadiusServer.findOne({ _id: assignment.radiusServerId, tenantId: assignment.tenantId, enabled: true }).select('+sharedSecret').lean();
  if (!radius) throw new Error('Enabled RADIUS server was not found in this tenant');
  const secret = decryptField(radius.sharedSecret);
  const context = { tenantId: String(assignment.tenantId), serverId: String(assignment.routerId), timeoutMs: 10000 };
  const rows = await sendCommand('/radius/print', [], context);
  const existing = (Array.isArray(rows) ? rows : []).find((row) => String(row.address || row.host || '') === String(radius.host));
  const values = [word('address', radius.host), word('secret', secret), word('service', 'ppp,hotspot'), word('authentication-port', radius.authenticationPort), word('accounting-port', radius.accountingPort), word('timeout', `${Math.ceil(radius.timeoutMs / 1000)}s`), word('comment', `Billing RADIUS ${radius.name}`)];
  if (existing && (existing['.id'] || existing.id)) await sendCommand('/radius/set', [word('numbers', existing['.id'] || existing.id), ...values], context);
  else await sendCommand('/radius/add', values, context);
  const verified = await sendCommand('/radius/print', ['?address=' + radius.host], context);
  if (!Array.isArray(verified) || !verified.length) throw new Error('Router did not confirm RADIUS configuration');
  if (assignment.pppProfile) {
    const profiles = await sendCommand('/ppp/profile/print', ['?name=' + assignment.pppProfile], context);
    const profile = Array.isArray(profiles) ? profiles[0] : null;
    if (!profile?.['.id']) throw new Error('PPP profile for RADIUS assignment was not found');
    await sendCommand('/ppp/aaa/set', [word('use-radius', 'yes'), word('accounting', 'yes'), word('interim-update', `${radius.interimAccountingInterval}s`)], context);
  }
  return { state: 'present', radiusServerId: String(radius._id), verified: true };
}

async function applyHotspotAssignment(assignment) {
  const username = String(assignment.username || '').trim();
  if (!username) throw new Error('Hotspot assignment has no username');
  const context = { tenantId: String(assignment.tenantId), serverId: String(assignment.routerId), timeoutMs: 10000 };
  const rows = await sendCommand('/ip/hotspot/user/print', ['?name=' + username], context);
  const user = Array.isArray(rows) ? rows[0] : null;
  if (!user?.['.id']) throw new Error('Hotspot user was not found on the selected router');
  const enabled = assignment.fup?.desired !== 'blocked' && assignment.desiredState !== 'suspended' && assignment.desiredState !== 'absent' && assignment.status !== 'released';
  await sendCommand('/ip/hotspot/user/set', [word('numbers', user['.id']), word('disabled', enabled ? 'no' : 'yes')], context);
  const verifiedRows = await sendCommand('/ip/hotspot/user/print', ['?name=' + username], context);
  const verified = Array.isArray(verifiedRows) ? verifiedRows[0] : null;
  const disabled = String(verified?.disabled || 'no').toLowerCase();
  if (!verified?.['.id'] || (enabled && ['yes', 'true'].includes(disabled)) || (!enabled && !['yes', 'true'].includes(disabled))) throw new Error('Router did not confirm hotspot access state');
  return { state: enabled ? 'present' : 'suspended', username, verified: true };
}

async function processNetworkOperations({ limit = 20, now = new Date() } = {}) {
  const summary = { completed: 0, retried: 0, failed: 0, unsupported: 0 };
  for (let index = 0; index < Math.min(limit, 100); index += 1) {
    const leaseToken = crypto.randomUUID();
    const operation = await NetworkOperation.findOneAndUpdate({ operationType: { $nin: ['fup.apply', 'fup.restore'] }, status: { $in: ['pending', 'processing'] }, nextAttemptAt: { $lte: now }, $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] }, { $set: { status: 'processing', leaseToken, leaseUntil: new Date(now.getTime() + 120000) }, $inc: { attempts: 1 } }, { sort: { nextAttemptAt: 1 }, new: true }).lean();
    if (!operation) break;
    const claim = { _id: operation._id, leaseToken };
    try {
      const assignment = await NetworkAssignment.findOne({ _id: operation.assignmentId, tenantId: operation.tenantId }).lean();
      if (!assignment) throw new Error('Network assignment no longer exists');
      let observed;
      if (assignment.accessType === 'static') observed = await applyStaticAssignment(assignment, operation);
      else if (assignment.accessType === 'pppoe' && assignment.authenticationMode === 'radius') observed = await configureRadiusForAssignment(assignment);
      else if (assignment.accessType === 'pppoe') observed = await applyPppoeAssignment(assignment);
      else if (assignment.accessType === 'hotspot') observed = await applyHotspotAssignment(assignment);
      else {
        await NetworkOperation.updateOne(claim, { $set: { status: 'failed', lastError: `${assignment.accessType} provisioning adapter is not enabled yet` }, $unset: { leaseUntil: 1, leaseToken: 1 } });
        summary.unsupported += 1;
        continue;
      }
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

const applyPppoeFup = (a, op) => require('./fupEnforcementService').createFupEnforcer()(a, op);
const applyHotspotFup = applyPppoeFup;
module.exports = { processNetworkOperations, applyStaticAssignment, applyPppoeAssignment, applyPppoeFup, applyHotspotAssignment, applyHotspotFup, configureRadiusForAssignment };
