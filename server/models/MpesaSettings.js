const mongoose = require('mongoose');

const MpesaSettingsSchema = new mongoose.Schema(
  {
    ispId: { type: String, index: true },
    businessName: { type: String, required: true },
    environment: { type: String, enum: ['sandbox', 'production'], default: 'sandbox' },
    consumerKey: { type: String },
    consumerSecret: { type: String },
    payMethod: { type: String, enum: ['paybill', 'buygoods'], default: 'paybill' },
    paybillShortcode: { type: String },
    paybillPasskey: { type: String },
    buyGoodsTill: { type: String },
    buyGoodsPasskey: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('MpesaSettings', MpesaSettingsSchema);
