'use strict';
const crypto = require('node:crypto');
const AccessOutbox = require('../models/AccessOutbox');
async function enqueueAccessSync({ tenantId, customerId }) {
  return AccessOutbox.findOneAndUpdate({ tenantId, customerId }, {
    $inc: { generation: 1 },
    $set: { status: 'pending', nextAttemptAt: new Date(), attempts: 0, lastError: null },
  }, { upsert: true, new: true });
}
async function processAccessOutbox({ limit = 20, now = new Date(), sync } = {}) {
  const synchronize = sync || require('./customerAccessService').syncCustomerAccessFromPayments;
  const summary = { completed: 0, retried: 0, failed: 0 };
  for (let index = 0; index < Math.min(limit, 100); index += 1) {
    const leaseToken = crypto.randomUUID();
    const job = await AccessOutbox.findOneAndUpdate({
      status: { $in: ['pending', 'processing'] }, nextAttemptAt: { $lte: now },
      $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
    }, { $set: { status: 'processing', leaseToken, leaseUntil: new Date(now.getTime() + 120000) }, $inc: { attempts: 1 } },
    { sort: { nextAttemptAt: 1 }, new: true }).lean();
    if (!job) break;
    const claim = { _id: job._id, leaseToken, generation: job.generation };
    try {
      await synchronize({ tenantId: job.tenantId, customerId: job.customerId, debugId: `access-${job._id}` });
      await AccessOutbox.updateOne(claim, { $set: { status: 'complete', completedAt: new Date(), lastError: null }, $unset: { leaseUntil: 1, leaseToken: 1 } });
      summary.completed += 1;
    } catch {
      const failed = job.attempts >= 8;
      await AccessOutbox.updateOne(claim, { $set: { status: failed ? 'failed' : 'pending',
        nextAttemptAt: new Date(now.getTime() + Math.min(3600000, 1000 * 2 ** job.attempts)),
        lastError: 'Router synchronization failed. Check router connectivity and retry.' },
      $unset: { leaseUntil: 1, leaseToken: 1 } });
      summary[failed ? 'failed' : 'retried'] += 1;
    } finally {
      // A newer desired state arrived while this lease was running. Release only our lease.
      await AccessOutbox.updateOne({ _id: job._id, leaseToken, generation: { $ne: job.generation } },
        { $set: { status: 'pending' }, $unset: { leaseUntil: 1, leaseToken: 1 } });
    }
  }
  return summary;
}
module.exports = { enqueueAccessSync, processAccessOutbox };
