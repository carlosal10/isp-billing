'use strict';

const { scheduleJob } = require('../utils/scheduler');
const JobRun = require('../models/JobRun');
const JobActionLog = require('../models/JobActionLog');

function parsePositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

async function pruneJobHistory() {
  const now = Date.now();
  const runRetentionDays = parsePositiveInt(process.env.JOB_RUN_RETENTION_DAYS, 90);
  const actionRetentionDays = parsePositiveInt(process.env.JOB_ACTION_RETENTION_DAYS, 180);

  const runCutoff = new Date(now - runRetentionDays * 24 * 60 * 60 * 1000);
  const actionCutoff = new Date(now - actionRetentionDays * 24 * 60 * 60 * 1000);

  const [runResult, actionResult] = await Promise.all([
    JobRun.deleteMany({ startedAt: { $lt: runCutoff } }).catch(() => ({ deletedCount: 0 })),
    JobActionLog.deleteMany({ createdAt: { $lt: actionCutoff } }).catch(() => ({ deletedCount: 0 })),
  ]);

  return {
    runRetentionDays,
    actionRetentionDays,
    runCutoff: runCutoff.toISOString(),
    actionCutoff: actionCutoff.toISOString(),
    jobRunsDeleted: Number(runResult?.deletedCount) || 0,
    jobActionsDeleted: Number(actionResult?.deletedCount) || 0,
  };
}

scheduleJob({
  name: 'jobHistoryRetention',
  cronExpr: process.env.JOB_HISTORY_RETENTION_CRON || '15 3 * * *',
  lockTtlMs: 60 * 60 * 1000,
  allowManualRun: true,
  task: async () => {
    const summary = await pruneJobHistory();
    console.log('[jobHistoryRetention] prune summary', summary);
    return summary;
  },
});

console.log('Job history retention scheduled (03:15 default timezone).');

module.exports = { pruneJobHistory };
