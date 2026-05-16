'use strict';

const mongoose = require('mongoose');

const SchemaMigrationSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    description: { type: String, trim: true, default: '' },
    status: {
      type: String,
      enum: ['running', 'succeeded', 'failed'],
      default: 'running',
      index: true,
    },
    dryRun: { type: Boolean, default: true },
    startedAt: { type: Date, default: Date.now, index: true },
    finishedAt: { type: Date, default: null },
    durationMs: { type: Number, default: 0 },
    exitCode: { type: Number, default: null },
    command: { type: String, trim: true, default: null },
    stdoutTail: { type: String, default: null },
    stderrTail: { type: String, default: null },
    errorMessage: { type: String, trim: true, default: null },
    runBy: { type: String, trim: true, default: 'migration-runner' },
  },
  { timestamps: true, versionKey: false }
);

SchemaMigrationSchema.index({ status: 1, startedAt: -1 });

module.exports = mongoose.model('SchemaMigration', SchemaMigrationSchema);
