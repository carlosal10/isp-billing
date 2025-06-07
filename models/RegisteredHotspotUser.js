const mongoose = require('mongoose');

const registeredHotspotUserSchema = new mongoose.Schema({
  mac: String,
  phone: String,
  transactionId: String,
  plan: { type: mongoose.Schema.Types.ObjectId, ref: 'HotspotPlan' },
  expiresAt: Date
}, { timestamps: true });

module.exports = mongoose.model('RegisteredHotspotUser', registeredHotspotUserSchema);
