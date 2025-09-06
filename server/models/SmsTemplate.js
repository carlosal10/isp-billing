const mongoose = require('mongoose');

const SmsTemplateSchema = new mongoose.Schema(
  {
    // Tenant scope
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, required: true },

    // e.g., 'reminder-5', 'reminder-3', 'reminder-0', 'payment-link'
    type: { type: String, required: true },
    language: { type: String, default: 'en' },
    body: { type: String, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

SmsTemplateSchema.index({ tenantId: 1, type: 1, language: 1 }, { unique: true });

module.exports = mongoose.model('SmsTemplate', SmsTemplateSchema);

