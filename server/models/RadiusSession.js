'use strict';
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  routerId: { type: mongoose.Schema.Types.ObjectId, ref: 'MikroTikConnection', required: true },
  sessionKey: { type: String, required: true },
  username: { type: String, required: true },
  status: { type: String, enum: ['active', 'stopped'], required: true },
  startedAt: Date, lastEventAt: Date, stoppedAt: Date,
  sessionSeconds: { type: Number, default: 0 },
  // Decimal strings preserve 64-bit RADIUS counters beyond JavaScript's safe integer range.
  uploadBytes: { type: String, default: '0' }, downloadBytes: { type: String, default: '0' },
  framedIp: String, terminateCause: String,
  sourceKeyId: mongoose.Schema.Types.ObjectId,
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
schema.index({ tenantId: 1, routerId: 1, sessionKey: 1 }, { unique: true });
schema.index({ tenantId: 1, routerId: 1, lastEventAt: -1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('RadiusSession', schema);
