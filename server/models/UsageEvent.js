'use strict';
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  routerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  assignmentId: { type: mongoose.Schema.Types.ObjectId, default: null },
  customerId: { type: mongoose.Schema.Types.ObjectId, default: null },
  sessionKey: { type: String, required: true },
  source: { type: String, enum: ['radius', 'queue'], required: true },
  occurredAt: { type: Date, required: true },
  uploadBytes: { type: String, required: true, match: /^\d+$/ },
  downloadBytes: { type: String, required: true, match: /^\d+$/ },
  legacyBucket: { type: Boolean, default: false },
  counterReset: { type: Boolean, default: false },
}, { timestamps: true });
schema.index({ tenantId: 1, assignmentId: 1, occurredAt: 1 });
schema.index({ occurredAt: 1 }, { expireAfterSeconds: 400 * 86400 });
module.exports = mongoose.model('UsageEvent', schema);
