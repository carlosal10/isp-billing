const mongoose = require('mongoose');

const ReminderLogSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, required: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', index: true, required: true },
    type: { type: String, enum: ['T-5', 'T-3', 'T-0'], required: true },
    dueDate: { type: Date, required: true },
    phone: { type: String },
    messageId: { type: String },
    provider: { type: String },
    status: { type: String, enum: ['sent', 'failed'], default: 'sent' },
    error: { type: String },
  },
  { timestamps: true }
);

ReminderLogSchema.index({ tenantId: 1, customerId: 1, type: 1, dueDate: 1 }, { unique: true });

module.exports = mongoose.model('ReminderLog', ReminderLogSchema);

