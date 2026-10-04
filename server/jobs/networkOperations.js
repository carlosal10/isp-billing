'use strict';
const { scheduleJob } = require('../utils/scheduler');
const { processNetworkOperations } = require('../services/networkOperationService');

scheduleJob({
  name: 'network-operations',
  cronExpr: process.env.NETWORK_OPERATIONS_CRON || '* * * * *',
  noOverlap: true,
  task: async () => processNetworkOperations({ limit: Number(process.env.NETWORK_OPERATIONS_BATCH || 20) }),
});
