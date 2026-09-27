const mongoose = require('mongoose');
const { encryptField } = require('../security/fieldEncryption');

const PaymentConfigSchema = new mongoose.Schema(
  {
    ispId: { type: String, required: true },
    provider: { type: String, required: true, enum: ['mpesa','stripe','paypal'] },
    // Settings will vary by provider
    // --- M-Pesa (per-tenant) ---
    consumerKey: { type: String, set: encryptField },
    consumerSecret: { type: String, set: encryptField },
    payMethod: { type: String, enum: ['paybill', 'buygoods'], default: 'paybill' },
    environment: { type: String, enum: ['sandbox', 'production'], default: 'sandbox' },
    businessName: String,      // M-Pesa
    paybillShortcode: String,  // M-Pesa
    paybillPasskey: { type: String, set: encryptField },    // M-Pesa
    buyGoodsTill: String,      // M-Pesa
    buyGoodsPasskey: { type: String, set: encryptField },   // M-Pesa
    publishableKey: String,    // Stripe
    secretKey: { type: String, set: encryptField },         // Stripe
    clientId: { type: String, set: encryptField },          // PayPal
    clientSecret: { type: String, set: encryptField },      // PayPal
  },
  { timestamps: true }
);

PaymentConfigSchema.index({ ispId: 1, provider: 1 }, { unique: true });

module.exports = mongoose.model('PaymentConfig', PaymentConfigSchema);
