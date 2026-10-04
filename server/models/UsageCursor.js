'use strict';
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
 tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
 assignmentId: { type: mongoose.Schema.Types.ObjectId, required: true },
 uploadBytes: { type: String, required: true }, downloadBytes: { type: String, required: true },
 observedAt: { type: Date, required: true },
});
schema.index({ tenantId: 1, assignmentId: 1 }, { unique: true });
module.exports = mongoose.model('UsageCursor', schema);
