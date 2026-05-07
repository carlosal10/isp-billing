'use strict';

const mongoose = require('mongoose');

const billingLedgerEntrySchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, required: true },
    batchId: { type: String, trim: true, required: true, index: true },
    sourceType: {
      type: String,
      enum: ['invoice', 'payment', 'credit-note', 'credit-application', 'reversal', 'chargeback'],
      required: true,
      index: true,
    },
    sourceId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null, index: true },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null, index: true },
    creditNote: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditNote', default: null, index: true },
    account: { type: String, trim: true, required: true, index: true },
    direction: { type: String, enum: ['debit', 'credit'], required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, trim: true, uppercase: true, default: 'KES' },
    description: { type: String, trim: true, default: null },
    effectiveAt: { type: Date, default: Date.now, index: true },
    reversedAt: { type: Date, default: null, index: true },
    reversalBatchId: { type: String, trim: true, default: null },
    metadata: { type: Object, default: {} },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

billingLedgerEntrySchema.index({ tenantId: 1, effectiveAt: -1 });
billingLedgerEntrySchema.index({ tenantId: 1, sourceType: 1, sourceId: 1 });

module.exports = mongoose.model('BillingLedgerEntry', billingLedgerEntrySchema);
