'use strict';

const mongoose = require('mongoose');

const PaymentGatewayCorrelationSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true, trim: true, index: true },
    kind: { type: String, required: true, trim: true, index: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', default: null },
    accountNumber: { type: String, default: null, trim: true },
    phoneNumber: { type: String, default: null, trim: true },
    amount: { type: Number, default: null },
    checkoutRequestId: { type: String, default: null, trim: true, index: true },
    merchantRequestId: { type: String, default: null, trim: true, index: true },
    source: { type: String, default: null, trim: true },
    callbackUrl: { type: String, default: null, trim: true },
    consumedAt: { type: Date, default: null },
    lastCallbackAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

PaymentGatewayCorrelationSchema.index(
  { provider: 1, checkoutRequestId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      checkoutRequestId: { $type: 'string', $ne: '' },
    },
  }
);

PaymentGatewayCorrelationSchema.index(
  { provider: 1, merchantRequestId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      merchantRequestId: { $type: 'string', $ne: '' },
    },
  }
);

module.exports = mongoose.model('PaymentGatewayCorrelation', PaymentGatewayCorrelationSchema);
