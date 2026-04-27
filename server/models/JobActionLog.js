const mongoose = require('mongoose');

const JobActionLogSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, index: true },
    action: { type: String, required: true, enum: ['run', 'pause', 'resume'], index: true },
    tenantId: { type: String, default: null, index: true },
    actor: { type: String, default: null },
    role: { type: String, default: null },
    note: { type: String, default: null },
    ok: { type: Boolean, default: true, index: true },
    error: { type: String, default: null },
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

JobActionLogSchema.index({ name: 1, createdAt: -1 });

module.exports = mongoose.model('JobActionLog', JobActionLogSchema);
