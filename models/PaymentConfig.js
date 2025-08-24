const mongoose = require('mongoose');

const PaymentConfigSchema = new mongoose.Schema(
  {
    ispId: { type: String, required: true },
    provider: { type: String, required: true, enum: ['mpesa','stripe','paypal'] },
    // Settings will vary by provider
    businessName: String,      // M-Pesa
    paybillShortcode: String,  // M-Pesa
    paybillPasskey: String,    // M-Pesa
    buyGoodsTill: String,      // M-Pesa
    buyGoodsPasskey: String,   // M-Pesa
    publishableKey: String,    // Stripe
    secretKey: String,         // Stripe
    clientId: String,          // PayPal
    clientSecret: String,      // PayPal
  },
  { timestamps: true }
);

module.exports = mongoose.model('PaymentConfig', PaymentConfigSchema);
