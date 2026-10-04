'use strict';
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  name: { type: String, required: true, trim: true },
  includedBytes: { type: String, required: true, match: /^\d+$/ },
  period: { type: String, enum: ['monthly', 'rolling-30d'], default: 'monthly' },
  measurement: { type: String, enum: ['combined', 'upload', 'download'], default: 'combined' },
  warningPercent: { type: Number, default: 80, min: 1, max: 100 },
  throttlePercent: { type: Number, default: 100, min: 1, max: 1000 },
  throttleDownload: { type: String, default: '2M' },
  throttleUpload: { type: String, default: '512K' },
  hardBlockPercent: { type: Number, default: null, min: 100, max: 10000 },
  resetTimezone: { type: String, default: 'Africa/Nairobi' },
  enabled: { type: Boolean, default: true, index: true },
}, { timestamps: true, versionKey: false });
schema.index({ tenantId: 1, name: 1 }, { unique: true });
module.exports = mongoose.model('FupPolicy', schema);
