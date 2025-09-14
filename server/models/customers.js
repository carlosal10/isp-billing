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
  // Unique per-tenant (not globally unique)
  accountNumber: { type: String },

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
