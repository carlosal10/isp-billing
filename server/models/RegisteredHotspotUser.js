// models/RegisteredHotspotUser.js
const mongoose = require('mongoose');

const RegisteredHotspotUserSchema = new mongoose.Schema({
  mac: { type: String, required: true },
  phone: { type: String, required: true },
  plan: { type: mongoose.Schema.Types.ObjectId, ref: 'HotspotPlan' },
  expiresAt: { type: Date, required: true },
  transactionId: String,
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('RegisteredHotspotUser', RegisteredHotspotUserSchema);
