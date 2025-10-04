'use strict';

const mongoose = require('mongoose');

const JobRunSchema = new mongoose.Schema(
  {
    name: { type: String, index: true },
    startedAt: { type: Date, default: Date.now, index: true },
    finishedAt: { type: Date },
    ok: { type: Boolean, index: true },
    error: { type: String },
    stats: { type: Object },
  },
  { versionKey: false }
);

JobRunSchema.index({ name: 1, startedAt: -1 });

module.exports = mongoose.model('JobRun', JobRunSchema);

