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
  networkType: { type: String, enum: ['pppoe', 'static'], required: true },
  pppoeProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'PPPoEProfile', default: null },
  staticConfig: {
    ip: { type: String },
    gateway: { type: String },
    dns: { type: String }
  }
});
module.exports = mongoose.model('Customer', customerSchema);