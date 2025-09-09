const mongoose = require('mongoose');

const SmsSettingsSchema = new mongoose.Schema(
  {
    // Tenant scope
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, required: true },

    enabled: { type: Boolean, default: false },
    defaultLanguage: { type: String, default: 'en' },
    senderId: { type: String, default: '' },

    primaryProvider: { type: String, enum: ['twilio', 'africastalking'], default: 'twilio' },
    fallbackEnabled: { type: Boolean, default: false },

    // Provider credentials (optional, per-tenant)
    twilio: {
      accountSid: String,
      authToken: String,
      from: String,
    },
    africastalking: {
      apiKey: String,
      username: String,
      from: String,
    },

    // Simple schedule config (days/hours before expiry)
  schedule: {
      reminder5Days: { type: Boolean, default: true },
      reminder3Days: { type: Boolean, default: true },
      dueWarnHours: { type: Number, default: 4 },
    },

    // Automation toggles
    autoSendOnCreate: { type: Boolean, default: false },
    autoSendOnPlanChange: { type: Boolean, default: false },
    autoTemplateType: { type: String, default: 'payment-link' },
  },
  { timestamps: true }
);

SmsSettingsSchema.index({ tenantId: 1 }, { unique: true });

module.exports = mongoose.model('SmsSettings', SmsSettingsSchema);
