'use strict';

const mongoose = require('mongoose');

const EVENT_STATUS = ['received', 'processing', 'processed', 'unmatched', 'failed', 'rejected'];

const PaymentGatewayEventSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true, trim: true, index: true },
    kind: { type: String, required: true, trim: true, index: true },
    eventType: { type: String, default: null, trim: true },
    dedupeKey: { type: String, required: true, trim: true, unique: true, index: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null, index: true },
    sourcePath: { type: String, default: null, trim: true },
    externalId: { type: String, default: null, trim: true, index: true },
    externalRef: { type: String, default: null, trim: true },
    transactionId: { type: String, default: null, trim: true },
    accountNumber: { type: String, default: null, trim: true },
    phoneNumber: { type: String, default: null, trim: true },
    amount: { type: Number, default: null },
    currency: { type: String, default: null, trim: true },
    resultCode: { type: Number, default: null },
    resultDesc: { type: String, default: null, trim: true },
    matchedBy: { type: String, default: null, trim: true },
    queueOwner: { type: String, default: null, trim: true, index: true },
    queueOwnerDisplay: { type: String, default: null, trim: true },
    queueClaimedAt: { type: Date, default: null, index: true },
    queueReleasedAt: { type: Date, default: null },
    queueReleasedBy: { type: String, default: null, trim: true },
    eventStatus: {
      type: String,
      enum: EVENT_STATUS,
      default: 'received',
      index: true,
    },
    processingError: { type: String, default: null },
    attemptCount: { type: Number, default: 0 },
    duplicateCount: { type: Number, default: 0 },
    firstSeenAt: { type: Date, default: Date.now, index: true },
    lastSeenAt: { type: Date, default: Date.now },
    processingStartedAt: { type: Date, default: null },
    handledAt: { type: Date, default: null },
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
    headers: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

PaymentGatewayEventSchema.index({ tenantId: 1, createdAt: -1 });
PaymentGatewayEventSchema.index({ provider: 1, kind: 1, createdAt: -1 });
PaymentGatewayEventSchema.index({ paymentId: 1, createdAt: -1 });
PaymentGatewayEventSchema.index({ tenantId: 1, queueOwner: 1, createdAt: -1 });

module.exports = mongoose.model('PaymentGatewayEvent', PaymentGatewayEventSchema);
