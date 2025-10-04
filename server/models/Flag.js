'use strict';

const mongoose = require('mongoose');

const FlagSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    key: { type: String, required: true },
    enabled: { type: Boolean, default: false },
    description: { type: String },
    rollout: { type: Number, default: 100 }, // percentage
  },
  { timestamps: true, versionKey: false }
);

FlagSchema.index({ tenantId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('Flag', FlagSchema);

