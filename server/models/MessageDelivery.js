'use strict';

const mongoose = require('mongoose');

const MessageDeliverySchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    channel: {
      type: String,
      enum: ['sms', 'email', 'whatsapp', 'system'],
      default: 'sms',
      index: true,
    },
    direction: {
      type: String,
      enum: ['outbound', 'inbound'],
      default: 'outbound',
      index: true,
    },
    provider: { type: String, trim: true, default: null, index: true },
    templateType: { type: String, trim: true, default: null, index: true },
    language: { type: String, trim: true, default: 'en' },
    status: {
      type: String,
      enum: ['queued', 'sent', 'delivered', 'failed', 'skipped'],
      default: 'queued',
      index: true,
    },
    to: { type: String, trim: true, default: null },
    normalizedTo: { type: String, trim: true, default: null, index: true },
    subject: { type: String, trim: true, default: null },
    bodyPreview: { type: String, trim: true, default: null },
    bodyLength: { type: Number, default: 0, min: 0 },
    providerMessageId: { type: String, trim: true, default: null, index: true },
    providerStatus: { type: String, trim: true, default: null },
    cost: { type: String, trim: true, default: null },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', default: null },
    errorMessage: { type: String, trim: true, default: null },
    context: { type: Object, default: {} },
    sentAt: { type: Date, default: null, index: true },
    failedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, versionKey: false }
);

MessageDeliverySchema.index({ tenantId: 1, createdAt: -1 });
MessageDeliverySchema.index({ tenantId: 1, channel: 1, status: 1, createdAt: -1 });
MessageDeliverySchema.index({ tenantId: 1, customer: 1, createdAt: -1 });

module.exports = mongoose.model('MessageDelivery', MessageDeliverySchema);
