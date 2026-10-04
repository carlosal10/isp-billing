'use strict';

const mongoose = require('mongoose');

const networkAssignmentSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
  routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'MikroTikConnection', required: true, index: true },
  accessType: { type: String, enum: ['pppoe', 'static', 'hotspot'], required: true, index: true },
  authenticationMode: { type: String, enum: ['local', 'radius'], default: 'local', index: true },
  radiusServerId: { type: mongoose.Schema.Types.ObjectId, ref: 'RadiusServer', default: null, index: true },
  pppProfile: { type: String, trim: true, default: null },
  status: { type: String, enum: ['draft', 'provisioning', 'active', 'suspended', 'released', 'error'], default: 'draft', index: true },
  desiredState: { type: String, enum: ['absent', 'present', 'suspended'], default: 'present', index: true },
  observedState: { type: String, enum: ['unknown', 'absent', 'present', 'suspended', 'error'], default: 'unknown' },
  username: { type: String, trim: true, default: null },
  ipAddress: { type: String, trim: true, default: null },
  macAddress: { type: String, trim: true, default: null },
  vlanId: { type: Number, min: 1, max: 4094, default: null },
  profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', default: null },
  policyId: { type: mongoose.Schema.Types.ObjectId, ref: 'BandwidthPolicy', default: null },
  fupPolicyId: { type: mongoose.Schema.Types.ObjectId, ref: 'FupPolicy', default: null, index: true },
  fup: {
    generation: { type: Number, default: 0 },
    desired: { type: String, enum: ['normal', 'throttled', 'blocked'], default: 'normal' },
    applied: { type: String, enum: ['normal', 'throttled', 'blocked'], default: 'normal' },
    signature: String,
    baseline: { type: mongoose.Schema.Types.Mixed, default: null },
    overrideUntil: Date,
    overrideReason: String,
    lastError: String,
    lastAppliedAt: Date,
    radiusAcknowledgedAt: Date,
    leaseToken: String,
    leaseUntil: Date,
  },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  lastSynchronizedAt: { type: Date, default: null },
  lastError: { type: String, trim: true, default: null },
  releasedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

const activeStatuses = ['draft', 'provisioning', 'active', 'suspended', 'error'];
networkAssignmentSchema.index({ tenantId: 1, customerId: 1, accessType: 1 }, { unique: true, partialFilterExpression: { status: { $in: activeStatuses } } });
networkAssignmentSchema.index({ tenantId: 1, routerId: 1, ipAddress: 1 }, { unique: true, partialFilterExpression: { ipAddress: { $type: 'string' }, status: { $in: activeStatuses } } });
networkAssignmentSchema.index({ tenantId: 1, desiredState: 1, status: 1 });

module.exports = mongoose.model('NetworkAssignment', networkAssignmentSchema);
