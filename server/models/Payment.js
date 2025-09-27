// models/Payment.js
'use strict';

const mongoose = require('mongoose');

const METHOD_ENUM = ['mpesa', 'manual', 'stripe', 'paypal'];
const STATUS_ENUM = ['Pending', 'Success', 'Validated', 'Failed', 'Refunded', 'Reversed'];

const EditLogSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    by: { type: String, trim: true },
    // generic diff container, e.g. { amount:{from,to}, method:{from,to}, ... }
    changes: { type: Object, default: {} },
  },
  { _id: false }
);

const PaymentSchema = new mongoose.Schema(
  {
    // ---------- Tenant scope ----------
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      index: true,
      required: true,
    },

    // Redundant denorms for fast lookups / display
    accountNumber: { type: String, trim: true, required: true },
    phoneNumber: { type: String, trim: true }, // make optional: some gateways won’t supply it

    // Relations
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    plan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plan',
      required: true,
      index: true,
    },

    // Core fields
    amount: {
      type: Number,
      required: true,
      min: [0, 'Amount cannot be negative'],
    },
    transactionId: { type: String, trim: true }, // may be null for cash/manual
    method: {
      type: String,
      enum: METHOD_ENUM,
      required: true,
      default: 'manual',
      lowercase: true, // normalize
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: STATUS_ENUM,
      default: 'Pending',
      index: true,
    },

    // Entitlement
    expiryDate: { type: Date, index: true },

    // Validation / audit (manual or reconciled)
    validatedBy: { type: String, trim: true },
    validatedAt: { type: Date, index: true },
    notes: { type: String, trim: true },

    // ---------- Edit / audit trail ----------
    editedAt: { type: Date },
    editedBy: { type: String, trim: true },
    editLog: { type: [EditLogSchema], default: [] },

    // ---------- Soft delete ----------
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletedBy: { type: String, trim: true },
    deleteReason: { type: String, trim: true },
  },
  {
    timestamps: true, // createdAt, updatedAt
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_, ret) => {
        // Keep response clean
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

// ---------- Normalization / guards ----------
PaymentSchema.pre('validate', function normalizeFields() {
  if (this.method) this.method = String(this.method).toLowerCase().trim();
  if (this.transactionId != null) this.transactionId = String(this.transactionId).trim();
  if (this.accountNumber != null) this.accountNumber = String(this.accountNumber).trim();
  if (this.phoneNumber != null) this.phoneNumber = String(this.phoneNumber).trim();
  // Clamp negative to 0 (optional); otherwise the min validator will throw.
  if (typeof this.amount === 'number' && this.amount < 0) this.amount = 0;
});

// ---------- Instance helpers ----------
PaymentSchema.methods.softDelete = async function softDelete({ by, reason } = {}) {
  if (this.isDeleted) return this;
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = by || 'system';
  this.deleteReason = reason || 'soft-deleted';
  return this.save();
};

PaymentSchema.methods.restore = async function restore() {
  if (!this.isDeleted) return this;
  this.isDeleted = false;
  this.deletedAt = undefined;
  this.deletedBy = undefined;
  this.deleteReason = undefined;
  return this.save();
};

// ---------- Indexes ----------

// Recent first per tenant (common query)
PaymentSchema.index({ tenantId: 1, createdAt: -1 });

// Customer history per tenant
PaymentSchema.index({ tenantId: 1, customer: 1, createdAt: -1 });

// Fast filter by status/method per tenant
PaymentSchema.index({ tenantId: 1, status: 1, method: 1, createdAt: -1 });

// Unique transaction per tenant (ignores deleted + null/empty)
PaymentSchema.index(
  { tenantId: 1, transactionId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      transactionId: { $type: 'string', $ne: '' },
      isDeleted: { $ne: true },
    },
  }
);

// Optional: ensure no duplicate (tenant, tx, method) if your gateway recycles IDs across methods
// PaymentSchema.index(
//   { tenantId: 1, transactionId: 1, method: 1 },
//   {
//     unique: true,
//     partialFilterExpression: {
//       transactionId: { $type: 'string', $ne: '' },
//       isDeleted: { $ne: true },
//     },
//   }
// );

module.exports = mongoose.model('Payment', PaymentSchema);
