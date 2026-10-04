'use strict';
const { scheduleJob } = require('../utils/scheduler');
const { evaluateAllFup } = require('../services/fupEvaluationService');
scheduleJob({ name: 'fup-evaluation', cronExpr: process.env.FUP_EVALUATION_CRON || '*/5 * * * *', noOverlap: true, task: async () => ({
  migration: await require('../services/usageEventMigrationService').backfillLegacyUsage(),
  usage: await require('../services/staticUsageService').pollAllStaticUsage(),
  evaluation: await evaluateAllFup(),
}) });
