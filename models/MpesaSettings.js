const mongoose = require('mongoose');

const MpesaSettingsSchema = new mongoose.Schema({
  businessName: { type: String, required: true },
  
  paybillShortcode: { type: String, required: true },
  paybillPasskey: { type: String, required: true },
  
  buyGoodsTill: { type: String, required: true },
  buyGoodsPasskey: { type: String, required: true },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('MpesaSettings', MpesaSettingsSchema);
