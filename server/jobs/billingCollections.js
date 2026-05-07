'use strict';

const { scheduleJob } = require('../utils/scheduler');
const { processCollections } = require('../services/billingFinanceService');

scheduleJob({
  name: 'billingCollections',
  cronExpr: '0 */6 * * *',
  timezone: 'Africa/Nairobi',
  lockTtlMs: 3 * 60 * 60 * 1000,
  allowManualRun: true,
  task: async () => {
    return processCollections(new Date());
  },
});

console.log('Billing collections job scheduled (every 6 hours Africa/Nairobi)');

module.exports = {};
