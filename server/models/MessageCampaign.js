'use strict';

const mongoose = require('mongoose');

const MessageCampaignSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, trim: true, required: true },
    channel: { type: String, enum: ['sms'], default: 'sms', index: true },
    status: {
      type: String,
      enum: ['draft', 'sending', 'sent', 'partial', 'failed'],
      default: 'draft',
      index: true,
    },
    templateType: { type: String, trim: true, default: 'broadcast', index: true },
    language: { type: String, trim: true, default: 'en' },
    category: { type: String, trim: true, default: 'service' },
    bodyPreview: { type: String, trim: true, default: null },
    audience: { type: Object, default: {} },
    includePaylink: { type: Boolean, default: false },
    dueAt: { type: Date, default: null },
    counts: {
      total: { type: Number, default: 0, min: 0 },
      sendable: { type: Number, default: 0, min: 0 },
      sent: { type: Number, default: 0, min: 0 },
      skipped: { type: Number, default: 0, min: 0 },
      failed: { type: Number, default: 0, min: 0 },
      missingPhone: { type: Number, default: 0, min: 0 },
    },
    createdBy: { type: String, default: null },
    sentBy: { type: String, default: null },
    sentAt: { type: Date, default: null, index: true },
    errorMessage: { type: String, trim: true, default: null },
    deliveryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MessageDelivery' }],
  },
  { timestamps: true, versionKey: false }
);

MessageCampaignSchema.index({ tenantId: 1, createdAt: -1 });
MessageCampaignSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('MessageCampaign', MessageCampaignSchema);
