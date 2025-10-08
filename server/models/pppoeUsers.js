// models/PppoeUser.js
const mongoose = require('mongoose');

const PppoeUserSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
  username: { type: String, required: true },
  password: String,
  profile: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },
  service: { type: String, default: 'pppoe' },
  disabled: { type: Boolean, default: false },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
  expiresAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

PppoeUserSchema.index({ tenantId: 1, username: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('PppoeUser', PppoeUserSchema);
