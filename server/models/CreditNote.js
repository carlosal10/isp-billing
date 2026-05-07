'use strict';

const mongoose = require('mongoose');

const creditNoteSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', index: true, required: true },
    sourcePayment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null, index: true },
    sourceInvoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null, index: true },
    creditNoteNumber: { type: String, trim: true, sparse: true, index: true },
    currency: { type: String, trim: true, uppercase: true, default: 'KES' },
    amount: { type: Number, required: true, min: 0 },
    remainingAmount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['open', 'partially_applied', 'applied', 'reversed'],
      default: 'open',
      index: true,
    },
    reason: { type: String, trim: true, default: null },
    issuedAt: { type: Date, default: Date.now, index: true },
    appliedAt: { type: Date, default: null },
    reversedAt: { type: Date, default: null },
    reversedReason: { type: String, trim: true, default: null },
    metadata: { type: Object, default: {} },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

creditNoteSchema.index({ tenantId: 1, customer: 1, status: 1, issuedAt: 1 });
creditNoteSchema.index({ tenantId: 1, creditNoteNumber: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('CreditNote', creditNoteSchema);
