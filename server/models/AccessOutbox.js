'use strict';
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  generation: { type: Number, default: 1 },
  status: { type: String, enum: ['pending', 'processing', 'complete', 'failed'], default: 'pending' },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  leaseUntil: Date,
  leaseToken: String,
  lastError: String,
  completedAt: Date,
}, { timestamps: true });
schema.index({ tenantId: 1, customerId: 1 }, { unique: true });
schema.index({ status: 1, nextAttemptAt: 1, leaseUntil: 1 });
module.exports = mongoose.model('AccessOutbox', schema);
