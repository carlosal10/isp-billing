'use strict';
const mongoose = require('mongoose');
const { encryptField } = require('../security/fieldEncryption');

const schema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  name: { type: String, required: true, trim: true },
  host: { type: String, required: true, trim: true },
  authenticationPort: { type: Number, default: 1812, min: 1, max: 65535 },
  accountingPort: { type: Number, default: 1813, min: 1, max: 65535 },
  sharedSecret: { type: String, required: true, set: encryptField, select: false },
  protocol: { type: String, enum: ['udp', 'radsec'], default: 'udp' },
  timeoutMs: { type: Number, default: 3000, min: 250, max: 30000 },
  retries: { type: Number, default: 2, min: 0, max: 10 },
  interimAccountingInterval: { type: Number, default: 300, min: 60, max: 86400 },
  enabled: { type: Boolean, default: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, versionKey: false });

schema.index({ tenantId: 1, name: 1 }, { unique: true });
module.exports = mongoose.model('RadiusServer', schema);
