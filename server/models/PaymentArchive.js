'use strict';

const mongoose = require('mongoose');

const PaymentArchiveSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
    originalId: { type: mongoose.Schema.Types.ObjectId, index: true },
    data: { type: Object },
    archivedAt: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false }
);

PaymentArchiveSchema.index({ tenantId: 1, archivedAt: -1 });

module.exports = mongoose.model('PaymentArchive', PaymentArchiveSchema);

