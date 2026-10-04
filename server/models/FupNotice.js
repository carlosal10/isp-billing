'use strict';
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  assignmentId: { type: mongoose.Schema.Types.ObjectId, required: true },
  customerId: mongoose.Schema.Types.ObjectId,
  key: { type: String, required: true },
  state: String, message: String, acknowledgedAt: Date,
}, { timestamps: true });
schema.index({ tenantId: 1, key: 1 }, { unique: true });
module.exports = mongoose.model('FupNotice', schema);
