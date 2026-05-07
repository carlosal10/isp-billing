const mongoose = require('mongoose');

const INVOICE_STATUS = [
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'overdue',
  'voided',
];

const AUTOPAY_STATUS = [
  'not-applicable',
  'eligible',
  'pending',
  'retrying',
  'succeeded',
  'failed',
  'disabled',
];

const DUNNING_STAGE = [
  'none',
  'upcoming',
  'due',
  'grace',
  'final-notice',
  'collections',
  'suspended',
];

const BILLING_REASON = [
  'manual',
  'renewal',
  'proration',
  'adjustment',
  'migration',
];

const InvoiceLineItemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true, trim: true },
    kind: {
      type: String,
      trim: true,
      default: 'service',
    },
    quantity: { type: Number, default: 1, min: 0 },
    unitPrice: { type: Number, default: 0, min: 0 },
    amount: { type: Number, default: 0 },
    metadata: { type: Object, default: {} },
  },
  { _id: false }
);

const invoiceSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true, index: true },
    sourcePayment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null, index: true },
    invoiceNumber: { type: String, trim: true, index: true },
    documentType: { type: String, enum: ['invoice'], default: 'invoice' },
    currency: { type: String, trim: true, uppercase: true, default: 'KES' },
    issueDate: { type: Date, default: Date.now, index: true },
    dueDate: { type: Date, required: true, index: true },
    servicePeriodStart: { type: Date, default: null },
    servicePeriodEnd: { type: Date, default: null },
    generated: { type: Boolean, default: false },
    generatedAt: { type: Date, default: Date.now },
    billingReason: {
      type: String,
      enum: BILLING_REASON,
      default: 'manual',
      index: true,
    },
    lineItems: { type: [InvoiceLineItemSchema], default: [] },
    subtotal: { type: Number, default: 0, min: 0 },
    discountTotal: { type: Number, default: 0, min: 0 },
    taxTotal: { type: Number, default: 0, min: 0 },
    total: { type: Number, default: 0, min: 0 },
    amountPaid: { type: Number, default: 0, min: 0 },
    amountCredited: { type: Number, default: 0, min: 0 },
    balanceDue: { type: Number, default: 0, min: 0, index: true },
    status: {
      type: String,
      enum: INVOICE_STATUS,
      default: 'draft',
      index: true,
    },
    autopayEnabled: { type: Boolean, default: false },
    autopayStatus: {
      type: String,
      enum: AUTOPAY_STATUS,
      default: 'not-applicable',
    },
    autopayAttemptCount: { type: Number, default: 0, min: 0 },
    lastAutopayAttemptAt: { type: Date, default: null },
    nextAutopayRetryAt: { type: Date, default: null },
    lastAutopayError: { type: String, trim: true, default: null },
    dunningStage: {
      type: String,
      enum: DUNNING_STAGE,
      default: 'none',
      index: true,
    },
    lastDunningAt: { type: Date, default: null },
    nextDunningAt: { type: Date, default: null },
    metadata: { type: Object, default: {} },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

function roundMoney(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

invoiceSchema.pre('validate', function normalizeInvoice() {
  const items = Array.isArray(this.lineItems) ? this.lineItems : [];
  for (const item of items) {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    if ((!item.amount || item.amount === 0) && Number.isFinite(quantity) && Number.isFinite(unitPrice)) {
      item.amount = roundMoney(quantity * unitPrice);
    } else {
      item.amount = roundMoney(item.amount);
    }
    item.quantity = Number.isFinite(quantity) ? quantity : 0;
    item.unitPrice = Number.isFinite(unitPrice) ? unitPrice : 0;
  }

  const subtotalFromLines = roundMoney(items.reduce((sum, item) => sum + Number(item.amount || 0), 0));
  this.subtotal = subtotalFromLines;
  this.discountTotal = roundMoney(this.discountTotal);
  this.taxTotal = roundMoney(this.taxTotal);
  this.total = roundMoney(subtotalFromLines - this.discountTotal + this.taxTotal);
  this.amountPaid = roundMoney(this.amountPaid);
  this.amountCredited = roundMoney(this.amountCredited);
  this.balanceDue = roundMoney(Math.max(0, this.total - this.amountPaid - this.amountCredited));

  if (this.status !== 'voided') {
    if (this.generated !== true && this.status === 'draft') {
      return;
    }
    if (this.balanceDue <= 0) {
      this.status = 'paid';
    } else if (this.amountPaid > 0 || this.amountCredited > 0) {
      this.status = 'partially_paid';
    } else if (this.dueDate) {
      const dueDay = new Date(this.dueDate);
      const currentDay = new Date();
      dueDay.setHours(0, 0, 0, 0);
      currentDay.setHours(0, 0, 0, 0);
      if (dueDay.getTime() < currentDay.getTime()) {
        this.status = 'overdue';
      } else {
        this.status = 'issued';
      }
    } else {
      this.status = 'issued';
    }
  }
});

invoiceSchema.virtual('amountDue').get(function amountDue() {
  return this.total;
});

invoiceSchema.virtual('amount').get(function amount() {
  return this.total;
});

invoiceSchema.index({ tenantId: 1, customer: 1, status: 1, dueDate: 1 });
invoiceSchema.index({ tenantId: 1, invoiceNumber: 1 }, { unique: true, sparse: true });
invoiceSchema.index({ tenantId: 1, sourcePayment: 1 }, { sparse: true });

module.exports = mongoose.model('Invoice', invoiceSchema);
