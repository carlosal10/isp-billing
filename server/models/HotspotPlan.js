const mongoose = require('mongoose');

const HotspotPlanSchema = new mongoose.Schema(
  {
    // Tenant scope
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, required: true },

    planName: { type: String, required: true },
    planPrice: { type: Number, required: true },
    planDuration: { type: String, required: true }, // e.g. '1h', '1d'
    planSpeed: { type: String, required: true },     // e.g. '2M/1M'
    mikrotikServer: { type: String, required: true },
    mikrotikProfile: { type: String, required: true },
    sharedSecret: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.model('HotspotPlan', HotspotPlanSchema);
