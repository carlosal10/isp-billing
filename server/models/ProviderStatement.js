'use strict';
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  provider: { type: String, enum: ['mpesa', 'stripe', 'paypal'], required: true },
  start: { type: Date, required: true }, end: { type: Date, required: true },
  digest: { type: String, required: true }, importedBy: { type: String, required: true },
  rows: [{ _id: false, reference: String, amount: Number, currency: String, occurredAt: Date }],
  acknowledgements: [{ _id: false, key: String, reason: String, actor: String, at: Date }],
}, { timestamps: true });
schema.index({ tenantId: 1, digest: 1 }, { unique: true });
module.exports = mongoose.model('ProviderStatement', schema);
