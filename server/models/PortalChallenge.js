'use strict';
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  _id: String,
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  digest: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  consumedAt: { type: Date, default: null },
});
module.exports = mongoose.model('PortalChallenge', schema);
