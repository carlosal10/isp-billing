'use strict';
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'MikroTikConnection', required: true, index: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
  assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'NetworkAssignment', default: null, index: true },
  sessionKey: { type: String, required: true },
  serviceType: { type: String, enum: ['pppoe', 'hotspot', 'static'], required: true },
  bucketStart: { type: Date, required: true, index: true },
  inputBytes: { type: String, default: '0' },
  outputBytes: { type: String, default: '0' },
  source: { type: String, enum: ['radius', 'router-poll', 'queue'], required: true },
  counterResetDetected: { type: Boolean, default: false },
  lastEventAt: Date,
}, { timestamps: true, versionKey: false });
schema.index({ tenantId: 1, routerId: 1, sessionKey: 1, bucketStart: 1 }, { unique: true });
module.exports = mongoose.model('UsageCounter', schema);
