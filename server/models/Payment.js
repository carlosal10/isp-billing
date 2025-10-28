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

  // Gateway correlation (e.g., M-Pesa STK ids)
  merchantRequestId: { type: String, trim: true },
  checkoutRequestId: { type: String, trim: true },

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

// ---------- Reconnection hook (trigger on successful payments) ----------
// Capture previous status before save so post-save can detect transitions.
PaymentSchema.pre('save', async function capturePrevStatus(next) {
  try {
    if (!this.isNew) {
      const prev = await mongoose.model('Payment').findById(this._id).select('status').lean();
      this._prevStatus = prev ? prev.status : null;
    } else {
      this._prevStatus = null;
    }
  } catch (err) {
    this._prevStatus = null;
  }
  return next();
});

PaymentSchema.post('save', async function postSaveTrigger(doc) {
  try {
    const prev = this._prevStatus || null;
    const nowStatus = doc.status || null;
    if (String(nowStatus) !== 'Success') return;
    if (prev === 'Success') return; // already handled

    // Perform reconnection actions: set customer active and re-enable router objects
    const Customer = mongoose.model('Customer');
    const Plan = mongoose.model('Plan');
    const { enableCustomerQueue, applyCustomerQueue, enablePppoeSecret } = require('../utils/mikrotikBandwidthManager');
    const AuditLog = (() => { try { return mongoose.model('AuditLog'); } catch(e) { return null; } })();

    const customer = await Customer.findById(doc.customer);
    if (!customer) return;

    // Refresh expiry if payment carries an expiryDate
    let updated = false;
    if (doc.expiryDate) {
      const current = customer.expiryDate ? new Date(customer.expiryDate) : null;
      const incoming = new Date(doc.expiryDate);
      if (!current || incoming > current) {
        customer.expiryDate = incoming;
        updated = true;
      }
    }
    // Set status active
    if (customer.status !== 'active') {
      customer.status = 'active';
      updated = true;
    }
    if (updated) {
      await customer.save().catch(() => {});
    }

    // Fetch plan for rate limits etc
    const plan = await Plan.findById(customer.plan).lean().catch(() => null);

    // Re-enable by connection type
    if (customer.connectionType === 'static') {
      // enable queue and address-list changes
      try {
        await enableCustomerQueue(customer, plan);
      } catch (err) {
        console.error('Failed to enable customer queue after payment:', err);
      }
    } else if (customer.connectionType === 'pppoe') {
      try {
        // enable PPPoE secret first, then reapply queue
        await enablePppoeSecret(customer).catch(() => {});
        await applyCustomerQueue(customer, plan).catch(() => {});
      } catch (err) {
        console.error('Failed to reconnect PPPoE customer after payment:', err);
      }
    } else {
      // fallback: reapply queue where applicable
      try { await applyCustomerQueue(customer, plan).catch(() => {}); } catch (_) {}
    }

    // Audit log (best-effort)
    if (AuditLog) {
      try {
        await AuditLog.create({
          userId: null,
          role: 'system',
          method: 'AUTO_RECONNECT',
          path: 'payment:postSave',
          statusCode: 200,
          ip: null,
          userAgent: 'system',
          payload: { paymentId: doc._id?.toString?.(), customerId: customer._id?.toString?.(), action: 'reconnect' }
        });
      } catch (_) {}
    }
  } catch (err) {
    // Do not throw — this is best-effort
    console.error('Payment post-save reconnection hook failed:', err?.message || err);
  }
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
