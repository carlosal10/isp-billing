const mongoose = require('mongoose');

const JobLockSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, index: true },
  lockedAt: { type: Date, default: Date.now },
  lockedUntil: { type: Date },
  holder: { type: String },
}, { versionKey: false });

module.exports = mongoose.model('JobLock', JobLockSchema);
