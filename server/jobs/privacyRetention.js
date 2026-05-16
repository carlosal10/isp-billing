'use strict';

const { scheduleJob } = require('../utils/scheduler');
const { prunePrivacyRetention } = require('../services/privacyRetentionService');

scheduleJob({
  name: 'privacyDataRetention',
  cronExpr: process.env.PRIVACY_RETENTION_CRON || '45 3 * * *',
  lockTtlMs: 60 * 60 * 1000,
  allowManualRun: true,
  task: async () => {
    const summary = await prunePrivacyRetention();
    console.log('[privacyDataRetention] prune summary', {
      totalMatched: summary.totalMatched,
      totalDeleted: summary.totalDeleted,
    });
    return summary;
  },
});

console.log('Privacy data retention scheduled (03:45 default timezone).');
