// models/HotspotAccess.js
const mongoose = require('mongoose');
const { encryptField } = require('../security/fieldEncryption');

const hotspotAccessSchema = new mongoose.Schema(
  {
    // Tenant scope
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, required: true },

    phone: String,
    macAddress: String,
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotspotPlan' },
    username: String,
    // Credentials are returned once at activation time, but never stored in plaintext.
    passwordEncrypted: { type: String, set: encryptField, select: false },
    expiresAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model('HotspotAccess', hotspotAccessSchema);
