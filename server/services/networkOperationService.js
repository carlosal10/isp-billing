'use strict';

const crypto = require('node:crypto');
const NetworkOperation = require('../models/NetworkOperation');
const NetworkAssignment = require('../models/NetworkAssignment');
const { financialTransaction } = require('./financialTransaction');
const { decryptField } = require('../security/fieldEncryption');
const { sendCommand } = require('../utils/mikrotikConnectionManager');
const { createPppoeService } = require('./pppoeService');

const MAX_ATTEMPTS = 8;

async function applyStaticAssignment(assignment, send = sendCommand) {
  return require('./staticProvisioningService').createStaticProvisioner(send)(assignment);
}

async function applyPppoeAssignment(assignment, send = sendCommand) {
  const username = String(assignment.username || '').trim();
  if (!username) throw new Error('PPPoE assignment has no username');
  const service = createPppoeService(send);
  const context = { tenantId: String(assignment.tenantId), serverId: String(assignment.routerId) };
  if (assignment.desiredState === 'absent' || assignment.status === 'released') {
    if (assignment.provisioningMode === 'link') {
      try { await service.ensureLinked(context, assignment); }
      catch (error) { if (error.statusCode !== 404) throw error; }
    }
    await service.remove(context, username, assignment.provisioningPassword || assignment.provisioningMode === 'link' ? String(assignment._id) : undefined);
    return { state: 'absent', username };
  }
  if (assignment.provisioningMode === 'link') {
    await service.ensureLinked(context, assignment);
  } else if (assignment.provisioningPassword) {
    await service.ensureProvisioned(context, { username, password: decryptField(assignment.provisioningPassword), profile: assignment.pppProfile, assignmentId: String(assignment._id), enabled: assignment.desiredState !== 'suspended' && assignment.fup?.desired !== 'blocked' });
  }
  if (assignment.provisioningPassword && assignment.credentialVersion > assignment.appliedCredentialVersion) {
    await service.password(context, username, decryptField(assignment.provisioningPassword));
  }
  const result = await service.setEnabled(context, [username], assignment.desiredState !== 'suspended' && assignment.fup?.desired !== 'blocked');
  return { state: result.enabled ? 'present' : 'suspended', username, verified: result.verified };
}

async function configureRadiusForAssignment(assignment) {
  if (assignment.authenticationMode !== 'radius') throw new Error('RADIUS operation requires authenticationMode=radius');
  throw Object.assign(new Error('RADIUS subscriber lifecycle requires an external authorization adapter.'), { statusCode: 409 });
}

async function applyHotspotAssignment(assignment, send = sendCommand) {
  return require('./hotspotProvisioningService').createHotspotProvisioner(send)(assignment, assignment.provisioningPassword ? decryptField(assignment.provisioningPassword) : null);
}

async function processNetworkOperations({ limit = 20, now = new Date(), send = sendCommand } = {}) {
  const summary = { completed: 0, retried: 0, failed: 0, unsupported: 0 };
  for (let index = 0; index < Math.min(limit, 100); index++) {
    const token = crypto.randomUUID();
    const op = await NetworkOperation.findOneAndUpdate({
      operationType: { $in: ['assignment.provision', 'assignment.reconcile', 'assignment.release'] },
      status: { $in: ['pending', 'processing'] }, nextAttemptAt: { $lte: now },
      $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
    }, { $set: { status: 'processing', leaseToken: token, leaseUntil: new Date(Date.now() + 180000) }, $inc: { attempts: 1 } }, { sort: { nextAttemptAt: 1 }, new: true }).lean();
    if (!op) break;
    const claim = { _id: op._id, leaseToken: token };
    let a, fence;
    try {
      a = await NetworkAssignment.findOneAndUpdate({
        _id: op.assignmentId, tenantId: op.tenantId,
        $or: [{ 'fup.leaseUntil': null }, { 'fup.leaseUntil': { $lte: new Date() } }],
      }, { $set: { 'fup.leaseToken': token, 'fup.leaseUntil': new Date(Date.now() + 180000) } }, { new: true }).select('+provisioningPassword').lean();
      if (!a) {
        if (!await NetworkAssignment.exists({ _id: op.assignmentId, tenantId: op.tenantId })) throw new Error('Assignment missing');
        await NetworkOperation.updateOne(claim, { $set: { status: 'pending', nextAttemptAt: new Date(Date.now() + 10000) }, $unset: { leaseUntil: 1, leaseToken: 1 }, $inc: { attempts: -1 } });
        continue;
      }
      fence = { _id: a._id, tenantId: a.tenantId, 'fup.leaseToken': token, desiredState: a.desiredState, 'fup.generation': a.fup?.generation || 0,
        $expr: { $and: [ { $eq: [{ $ifNull: ['$accessRevision', 0] }, a.accessRevision || 0] }, { $eq: [{ $ifNull: ['$credentialVersion', 0] }, a.credentialVersion || 0] } ] } };
      const guardedSend = async (...args) => {
        const held = await NetworkAssignment.updateOne(fence, { $set: { 'fup.leaseUntil': new Date(Date.now() + 180000) } });
        const lease = await NetworkOperation.updateOne(claim, { $set: { leaseUntil: new Date(Date.now() + 180000) } });
        if (!held.matchedCount || !lease.matchedCount) throw new Error('Assignment changed');
        return send(...args);
      };
      let observed;
      if (a.authenticationMode === 'radius') observed = await configureRadiusForAssignment(a);
      else if (a.accessType === 'static') observed = await applyStaticAssignment(a, guardedSend);
      else if (a.accessType === 'pppoe') observed = await applyPppoeAssignment(a, guardedSend);
      else if (a.accessType === 'hotspot') observed = await applyHotspotAssignment(a, guardedSend);
      else throw new Error('Unsupported access type');
      await financialTransaction(async () => {
        const updated = await NetworkAssignment.updateOne(fence, { $set: {
          observedState: observed.state, status: observed.state === 'present' ? 'active' : observed.state === 'absent' ? 'released' : 'suspended',
          lastSynchronizedAt: new Date(), lastError: null, appliedCredentialVersion: a.credentialVersion || 0, ...(observed.state === 'absent' ? { releasedAt: new Date() } : {}),
        } });
        if (!updated.matchedCount) throw new Error('Assignment changed before confirmation');
        const completed = await NetworkOperation.updateOne(claim, { $set: { status: 'complete', observedState: observed, completedAt: new Date(), lastError: null }, $unset: { leaseUntil: 1, leaseToken: 1 } });
        if (!completed.matchedCount) throw new Error('Operation lease lost');
      });
      summary.completed++;
    } catch (cause) {
      const failed = op.attempts >= MAX_ATTEMPTS;
      const error = cause.statusCode ? cause.message : 'Network change was not confirmed. Check router connectivity, permissions and requested state, then retry.';
      await NetworkOperation.updateOne(claim, { $set: { status: failed ? 'dead-letter' : 'pending', nextAttemptAt: new Date(Date.now() + Math.min(3600000, 1000 * 2 ** op.attempts)), lastError: error }, $unset: { leaseUntil: 1, leaseToken: 1 } });
      if (fence) await NetworkAssignment.updateOne(fence, { $set: { observedState: 'error', status: 'error', lastError: error } });
      summary[failed ? 'failed' : 'retried']++;
    } finally {
      if (a) await NetworkAssignment.updateOne({ _id: a._id, tenantId: a.tenantId, 'fup.leaseToken': token }, { $unset: { 'fup.leaseToken': 1, 'fup.leaseUntil': 1 } });
    }
  }
  return summary;
}

const applyPppoeFup = (a, op) => require('./fupEnforcementService').createFupEnforcer()(a, op);
const applyHotspotFup = applyPppoeFup;
module.exports = { processNetworkOperations, applyStaticAssignment, applyPppoeAssignment, applyPppoeFup, applyHotspotAssignment, applyHotspotFup, configureRadiusForAssignment };
