const mongoose = require('mongoose');

const JobScheduleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, index: true },
    paused: { type: Boolean, default: false, index: true },
    pausedAt: { type: Date, default: null },
    pausedBy: { type: String, default: null },
    pauseReason: { type: String, default: null },
    lastResumedAt: { type: Date, default: null },
    lastResumedBy: { type: String, default: null },
    lastManualRunAt: { type: Date, default: null },
    lastManualRunBy: { type: String, default: null },
    lastManualRunRole: { type: String, default: null },
    lastManualRunTenantId: { type: String, default: null },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model('JobSchedule', JobScheduleSchema);
