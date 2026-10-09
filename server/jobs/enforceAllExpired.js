'use strict';
const { scheduleJob } = require('../utils/scheduler');
const Customer = require('../models/customers');
const { enqueueAccessSync } = require('../services/accessOutboxService');
const { financialTransaction } = require('../services/financialTransaction');
const { runExpirySweep } = require('./expireAccess');
async function runUnifiedEnforce() {
  const sweep = await runExpirySweep();
  const summary = { customersQueued: 0, voucherSweep: sweep };
  const customers = await Customer.find({ status: { $ne: 'archived' }, $or: [
    { expiryDate: { $lt: new Date() } }, { status: { $in: ['inactive', 'expired'] } },
  ] }).select('_id tenantId').lean();
  for (const c of customers) await financialTransaction(async () => {
    const changed = await Customer.findOneAndUpdate({ _id: c._id, tenantId: c.tenantId, status: { $ne: 'archived' },
      $or: [{ expiryDate: { $lt: new Date() } }, { status: { $in: ['inactive', 'expired'] } }] }, { $set: { status: 'inactive' }, $inc: { __v: 1 } });
    if (!changed) return;
    await enqueueAccessSync({ tenantId: c.tenantId, customerId: c._id }); summary.customersQueued++;
  });
  return summary;
}
scheduleJob({ name: 'enforceAllExpired', cronExpr: '*/5 * * * *', lockTtlMs: 4 * 60 * 1000, allowManualRun: true, task: runUnifiedEnforce });
module.exports = { runUnifiedEnforce };
