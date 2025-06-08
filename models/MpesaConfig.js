const mongoose = require('mongoose');

const mpesaConfigSchema = new mongoose.Schema({
  ispId: { type: mongoose.Schema.Types.ObjectId, ref: 'ISP', required: true }, // each ISP has its own config
  payMethod: { type: String, enum: ['paybill', 'till'], required: true },
  shortCode: { type: String, required: true },
  passkey: { type: String, required: true },
  consumerKey: { type: String, required: true },
  consumerSecret: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('MpesaConfig', mpesaConfigSchema);
