// models/HotspotAccess.js
const mongoose = require('mongoose');

const hotspotAccessSchema = new mongoose.Schema({
  phone: String,
  macAddress: String,
  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotspotPlan' },
  username: String,
  password: String,
  expiresAt: Date,
}, { timestamps: true });

module.exports = mongoose.model('HotspotAccess', hotspotAccessSchema);
