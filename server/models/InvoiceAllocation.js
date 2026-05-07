'use strict';

const mongoose = require('mongoose');

const invoiceAllocationSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', index: true, required: true },
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', index: true, required: true },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', index: true, default: null },
    creditNote: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditNote', index: true, default: null },
    sourceType: {
      type: String,
      enum: ['payment', 'credit-note'],
      required: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, trim: true, uppercase: true, default: 'KES' },
    status: {
      type: String,
      enum: ['applied', 'reversed'],
      default: 'applied',
      index: true,
    },
    appliedAt: { type: Date, default: Date.now, index: true },
    reversedAt: { type: Date, default: null },
    reversalReason: { type: String, trim: true, default: null },
    note: { type: String, trim: true, default: null },
    batchId: { type: String, trim: true, default: null, index: true },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

invoiceAllocationSchema.index({ tenantId: 1, invoice: 1, status: 1, appliedAt: 1 });
invoiceAllocationSchema.index({ tenantId: 1, payment: 1, status: 1, appliedAt: 1 });
invoiceAllocationSchema.index({ tenantId: 1, creditNote: 1, status: 1, appliedAt: 1 });

module.exports = mongoose.model('InvoiceAllocation', invoiceAllocationSchema);
