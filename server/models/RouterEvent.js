'use strict';

const mongoose = require('mongoose');

const RouterEventSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, required: true },
    host: { type: String, index: true },
    port: { type: Number },
    kind: { type: String, index: true }, // e.g., mikrotik.exec
    ok: { type: Boolean, index: true },
    ms: { type: Number },
    command: { type: String },
    wordsCount: { type: Number },
    error: { type: String },
    at: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false }
);

RouterEventSchema.index({ tenantId: 1, at: -1 });

module.exports = mongoose.model('RouterEvent', RouterEventSchema);

