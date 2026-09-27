const mongoose = require('mongoose');
const { encryptField } = require('../security/fieldEncryption');

const MpesaSettingsSchema = new mongoose.Schema(
  {
    ispId: { type: String },
    businessName: { type: String, required: true },
    environment: { type: String, enum: ['sandbox', 'production'], default: 'sandbox' },
    consumerKey: { type: String, set: encryptField },
    consumerSecret: { type: String, set: encryptField },
    payMethod: { type: String, enum: ['paybill', 'buygoods'], default: 'paybill' },
    paybillShortcode: { type: String },
    paybillPasskey: { type: String, set: encryptField },
    buyGoodsTill: { type: String },
    buyGoodsPasskey: { type: String, set: encryptField },
  },
  { timestamps: true }
);

MpesaSettingsSchema.index({ ispId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('MpesaSettings', MpesaSettingsSchema);
