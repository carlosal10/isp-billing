'use strict';

const mongoose = require('mongoose');

const ApiKeySchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    label: { type: String, trim: true },
    keyHash: { type: String, required: true, unique: true },
    scopes: { type: [String], default: [] },
    active: { type: Boolean, default: true, index: true },
    lastUsedAt: { type: Date },
  },
  { timestamps: true, versionKey: false }
);

ApiKeySchema.index({ tenantId: 1, active: 1 });

module.exports = mongoose.model('ApiKey', ApiKeySchema);

