// models/HotspotAccess.js
const mongoose = require('mongoose');

const hotspotAccessSchema = new mongoose.Schema(
  {
    // Tenant scope
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, required: true },

    phone: String,
    macAddress: String,
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotspotPlan' },
    username: String,
    password: String,
    expiresAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model('HotspotAccess', hotspotAccessSchema);
