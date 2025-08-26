const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  address: String,
  routerIp: { type: String, default: null },
  status: { type: String, default: 'active' },
  accountNumber: { type: String, unique: true },

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

module.exports = mongoose.model('Customer', customerSchema);
