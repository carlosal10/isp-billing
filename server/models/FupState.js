'use strict';
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
  assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'NetworkAssignment', required: true, index: true },
  policyId: { type: mongoose.Schema.Types.ObjectId, ref: 'FupPolicy', required: true },
  periodStart: { type: Date, required: true }, periodEnd: { type: Date, required: true },
  consumedBytes: { type: String, default: '0' },
  state: { type: String, enum: ['normal', 'warned', 'throttled', 'blocked', 'overridden'], default: 'normal', index: true },
  lastEvaluatedAt: Date, appliedAt: Date, restoredAt: Date,
  generation: Number,
  enforcement: { type: String, enum: ['pending', 'applied', 'failed'], default: 'pending' },
  lastError: String,
}, { timestamps: true, versionKey: false });
schema.index({ tenantId: 1, assignmentId: 1, periodStart: 1 }, { unique: true });
module.exports = mongoose.model('FupState', schema);
