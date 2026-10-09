'use strict';
const mongoose = require('mongoose');
const Assignment = require('../models/NetworkAssignment');
const Operation = require('../models/NetworkOperation');
const Customer = require('../models/customers');
const { financialTransaction } = require('./financialTransaction');
const isBillable = customer => customer.status === 'active' && customer.expiryDate && new Date(customer.expiryDate).getTime() > Date.now();
function effectiveState(a) {
  if (a.desiredState === 'absent') return 'absent';
  return (a.manualState || a.desiredState) === 'suspended' || a.billingState === 'blocked' ? 'suspended' : 'present';
}
async function queueAssignment(a, actorId = null) {
  return Operation.create({ tenantId: a.tenantId, routerId: a.routerId, customerId: a.customerId, assignmentId: a._id,
    operationType: 'assignment.reconcile', idempotencyKey: 'assignment:' + a._id + ':' + new mongoose.Types.ObjectId(),
    desiredState: { status: a.desiredState }, actorId });
}
async function synchronizeBilling(customer, allowed) {
  return financialTransaction(async () => {
    // Shares the customer lock with service creation, editing and archival.
    const current = await Customer.findOneAndUpdate({ _id: customer._id, tenantId: customer.tenantId }, { $inc: { __v: 1 } });
    if (!current) return { managed: false, queued: 0 };
    const items = await Assignment.find({ tenantId: customer.tenantId, customerId: customer._id, status: { $ne: 'released' }, desiredState: { $ne: 'absent' } });
    let queued = 0;
    for (const a of items) {
      const next = allowed && isBillable(current) ? 'allowed' : 'blocked';
      if (a.billingState === next) continue;
      a.manualState = a.manualState || a.desiredState;
      a.billingState = next; a.desiredState = effectiveState(a); a.accessRevision++;
      a.status = 'provisioning'; await a.save(); await queueAssignment(a); queued++;
    }
    // Released services must never fall back to legacy router writes.
    const known = items.length || await Assignment.exists({ tenantId: customer.tenantId, customerId: customer._id });
    return { managed: !!known || current.networkWorkflowVersion === 2, queued };
  });
}
module.exports = { effectiveState, queueAssignment, synchronizeBilling, isBillable };
