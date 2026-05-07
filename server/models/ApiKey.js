'use strict';

const mongoose = require('mongoose');

const ApiKeySchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    label: { type: String, trim: true },
    description: { type: String, trim: true, default: '' },
    prefix: { type: String, trim: true, index: true },
    keyHash: { type: String, required: true, unique: true },
    scopes: { type: [String], default: [] },
    active: { type: Boolean, default: true, index: true },
    lastUsedAt: { type: Date },
    expiresAt: { type: Date, default: null, index: true },
    createdBy: { type: String, default: null },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: String, default: null },
    revokeReason: { type: String, default: null },
  },
  { timestamps: true, versionKey: false }
);

ApiKeySchema.index({ tenantId: 1, active: 1 });
ApiKeySchema.index({ tenantId: 1, prefix: 1 });

module.exports = mongoose.model('ApiKey', ApiKeySchema);
