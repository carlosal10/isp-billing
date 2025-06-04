// models/PppoeUser.js
const mongoose = require('mongoose');

const PppoeUserSchema = new mongoose.Schema({
  username: String,
  password: String,
  profile: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },
  service: { type: String, default: 'pppoe' },
  disabled: { type: Boolean, default: false },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PppoeUser', PppoeUserSchema);
