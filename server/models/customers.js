const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  // Tenant scope (required for multi-tenant isolation)
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, required: true },
  name: String,
  email: String,
  phone: String,
  address: String,
  routerIp: { type: String, default: null },
  status: { type: String, default: 'active' },
  expiryDate: { type: Date },
  // Unique per-tenant (not globally unique)
  accountNumber: { type: String },
  accountAliases: {
    type: [String],
    default: [],
  },

  // Link to plan
  plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },

  // Network setup
  connectionType: { type: String, enum: ['pppoe', 'static'], required: true },

  // PPPoE config as an object instead of ObjectId reference
  pppoeConfig: {
    profile: { type: String },
    localAddress: { type: String },
    rateLimit: { type: String },
  },

  staticConfig: {
    ip: { type: String },
    gateway: { type: String },
    dns: { type: String }
  },

  billingProfile: {
    invoiceLeadDays: { type: Number, default: 3 },
    autopayEnabled: { type: Boolean, default: false },
    preferredPaymentMethod: { type: String, default: 'mpesa' },
    preferredPhoneNumber: { type: String, default: null },
    stripeCustomerId: { type: String, default: null },
    stripePaymentMethodId: { type: String, default: null },
    graceDays: { type: Number, default: 3 },
    retryIntervalDays: { type: Number, default: 2 },
    maxAutopayAttempts: { type: Number, default: 3 },
  },

  portalProfile: {
    isEnabled: { type: Boolean, default: true },
    pinHash: { type: String, default: null },
    lastLoginAt: { type: Date, default: null },
    lastLoginMethod: { type: String, default: null },
    lastSeenAt: { type: Date, default: null },
  },

  communicationPreferences: {
    preferredLanguage: { type: String, default: 'en' },
    transactionalSmsEnabled: { type: Boolean, default: true },
    billingSmsEnabled: { type: Boolean, default: true },
    serviceAlertsSmsEnabled: { type: Boolean, default: true },
    marketingSmsEnabled: { type: Boolean, default: false },
    doNotContactUntil: { type: Date, default: null },
    quietHours: {
      enabled: { type: Boolean, default: false },
      start: { type: String, default: '21:00' },
      end: { type: String, default: '07:00' },
      timezone: { type: String, default: 'Africa/Nairobi' },
    },
    updatedAt: { type: Date, default: null },
    updatedBy: { type: String, default: null },
  }
});

// Indexes (must be declared before compiling the model)
// Ensure uniqueness by tenant for account numbers
customerSchema.index({ tenantId: 1, accountNumber: 1 }, { unique: true });
// Ensure static IPs are unique per-tenant (allow null/missing)
customerSchema.index(
  { tenantId: 1, 'staticConfig.ip': 1 },
  { unique: true, partialFilterExpression: { 'staticConfig.ip': { $type: 'string' } } }
);

module.exports = mongoose.model('Customer', customerSchema);
