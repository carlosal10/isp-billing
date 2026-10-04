'use strict';

const mongoose = require('mongoose');

const networkOperationSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'MikroTikConnection', default: null, index: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
  assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'NetworkAssignment', default: null, index: true },
  operationType: { type: String, required: true, trim: true, index: true },
  idempotencyKey: { type: String, required: true, trim: true },
  status: { type: String, enum: ['pending', 'processing', 'complete', 'failed', 'dead-letter'], default: 'pending', index: true },
  attempts: { type: Number, min: 0, default: 0 },
  desiredState: { type: mongoose.Schema.Types.Mixed, default: {} },
  observedState: { type: mongoose.Schema.Types.Mixed, default: {} },
  lastError: { type: String, trim: true, default: null },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  completedAt: { type: Date, default: null },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, versionKey: false });

networkOperationSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
networkOperationSchema.index({ status: 1, nextAttemptAt: 1 });

module.exports = mongoose.model('NetworkOperation', networkOperationSchema);
