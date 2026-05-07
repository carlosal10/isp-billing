'use strict';

const { scheduleJob } = require('../utils/scheduler');
const { processRecurringInvoices } = require('../services/billingFinanceService');

scheduleJob({
  name: 'recurringBilling',
  cronExpr: '0 7 * * *',
  timezone: 'Africa/Nairobi',
  lockTtlMs: 4 * 60 * 60 * 1000,
  allowManualRun: true,
  task: async () => {
    return processRecurringInvoices(new Date());
  },
});

console.log('Recurring billing job scheduled (07:00 Africa/Nairobi)');

module.exports = {};
