const mongoose = require('mongoose');

const DailyUsageSchema = new mongoose.Schema({
  // Tenant scope for multi-tenant separation
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, required: true },

  date: { type: Date, required: true },
  activeUsersCount: { type: Number, default: 0 },
  usagePerUser: [
    {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      bytesIn: { type: Number, default: 0 },
      bytesOut: { type: Number, default: 0 },
    },
  ],
}, { timestamps: true });

DailyUsageSchema.index({ tenantId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('DailyUsage', DailyUsageSchema);
