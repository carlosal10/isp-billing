'use strict';

const mongoose = require('mongoose');

const ASSIGNMENT_PURPOSE = [
  'customer-wan',
  'device-management',
  'hotspot',
  'gateway',
  'infrastructure',
  'reserved',
];

const ASSIGNMENT_STATUS = ['allocated', 'reserved', 'released'];

const ipAssignmentSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    pool: { type: mongoose.Schema.Types.ObjectId, ref: 'IpPool', required: true, index: true },
    ipAddress: { type: String, required: true, trim: true, index: true },
    status: { type: String, enum: ASSIGNMENT_STATUS, default: 'allocated', index: true },
    purpose: { type: String, enum: ASSIGNMENT_PURPOSE, default: 'customer-wan', index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    asset: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryAsset', default: null, index: true },
    note: { type: String, trim: true, default: null },
    allocatedAt: { type: Date, default: Date.now, index: true },
    releasedAt: { type: Date, default: null, index: true },
    releasedReason: { type: String, trim: true, default: null },
    metadata: { type: Object, default: {} },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

ipAssignmentSchema.pre('validate', function normalizeIpAssignment() {
  if (this.ipAddress) this.ipAddress = String(this.ipAddress).trim();
  if (this.status !== 'released') {
    this.releasedAt = null;
    this.releasedReason = null;
  }
});

ipAssignmentSchema.index(
  { tenantId: 1, ipAddress: 1 },
  {
    unique: true,
    partialFilterExpression: { releasedAt: null },
  }
);
ipAssignmentSchema.index({ tenantId: 1, pool: 1, status: 1, allocatedAt: -1 });

module.exports = mongoose.model('IpAssignment', ipAssignmentSchema);
