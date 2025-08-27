const mongoose = require('mongoose');

const MpesaSettingsSchema = new mongoose.Schema({
  businessName: { type: String, required: true },

  paybillShortcode: { type: String },
  paybillPasskey: { type: String },

  buyGoodsTill: { type: String },
  buyGoodsPasskey: { type: String },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('MpesaSettings', MpesaSettingsSchema);
