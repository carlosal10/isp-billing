// server/jobs/expireStatic.js
'use strict';

/**
 * expireStatic.js — improved
 *
 * Changes:
 * - groups expired static customers by tenant to avoid cross-tenant bursts
 * - per-tenant serialized task queue (concurrency = 1)
 * - retries with exponential backoff for transient errors when calling disableCustomerQueue
 * - defensive DB/operation handling and clearer logging
 * - preserves original schedule and basic functionality
 */

const { scheduleJob } = require('../utils/scheduler');
const Payment = require('../models/Payment');
const Customer = require('../models/customers');
const { disableCustomerQueue } = require('../utils/mikrotikBandwidthManager');

const RETRY_COUNT = 3;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 10_000;
const TENANT_CONCURRENCY = 1;
const INTER_TASK_DELAY_MS = 200;

function isTransientErr(err) {
  if (!err) return false;
  const s = String(err?.message || err || '').toLowerCase();
  return /timeout|unknownreply|!empty|econn|ehost|network|connect|reset/i.test(s);
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function executeWithRetries(fn) {
  let attempt = 0;
  let lastErr = null;
  while (attempt < RETRY_COUNT) {
    attempt += 1;
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientErr(err) || attempt >= RETRY_COUNT) {
        throw err;
      }
      const backoff = Math.min(RETRY_BASE_MS * Math.pow(2, attempt - 1), RETRY_MAX_MS);
      console.warn(`[expireStatic] transient error attempt ${attempt}, backing off ${backoff}ms:`, String(err?.message || err));
      await sleep(backoff);
    }
  }
  throw lastErr || new Error('operation failed after retries');
}

// lightweight per-tenant queue
const tenantQueues = new Map();
function enqueueTenantTask(tenantId, taskFn) {
  if (!tenantId) {
    return executeWithRetries(taskFn);
  }

  let q = tenantQueues.get(tenantId);
  if (!q) {
    q = { running: 0, waiters: [] };
    tenantQueues.set(tenantId, q);
  }

  return new Promise((resolve, reject) => {
    q.waiters.push({ taskFn, resolve, reject });
    processTenantQueue(tenantId).catch((e) => {
      console.warn('[expireStatic] tenant queue processor error', e?.message || e);
    });
  });
}

async function processTenantQueue(tenantId) {
  const q = tenantQueues.get(tenantId);
  if (!q) return;
  if (q.running >= TENANT_CONCURRENCY) return;
  const item = q.waiters.shift();
  if (!item) {
    if (q.running === 0) tenantQueues.delete(tenantId);
    return;
  }
  q.running += 1;
  try {
    const res = await executeWithRetries(item.taskFn);
    item.resolve(res);
  } catch (err) {
    item.reject(err);
  } finally {
    q.running -= 1;
    setTimeout(() => processTenantQueue(tenantId).catch(() => {}), INTER_TASK_DELAY_MS);
  }
}

// main scheduled job
scheduleJob({
  name: 'expireStatic',
  cronExpr: '*/10 * * * *',
  task: async () => {
    const now = new Date();

    try {
      // group latest successful payment per customer (with expiryDate) and keep only expired ones
      const latest = await Payment.aggregate([
        { $match: { status: 'Success', expiryDate: { $ne: null } } },
        { $sort: { customer: 1, expiryDate: -1 } },
        { $group: { _id: '$customer', expiryDate: { $first: '$expiryDate' }, tenantId: { $first: '$tenantId' } } },
        { $match: { expiryDate: { $lt: now } } },
      ]).allowDiskUse(true).catch((e) => {
        console.warn('[expireStatic] payment aggregation failed', String(e?.message || e));
        return [];
      });

      if (!Array.isArray(latest) || latest.length === 0) {
        return { expired: 0 };
      }

      // fetch customers in bulk by ids -> filter static connection type and present tenantId
      const customerIds = latest.map((r) => r._id).filter(Boolean);
      const customers = await Customer.find({
        _id: { $in: customerIds },
        connectionType: 'static',
      }).select('_id tenantId accountNumber').lean().catch((e) => {
        console.warn('[expireStatic] failed to fetch customers', String(e?.message || e));
        return [];
      });

      if (!Array.isArray(customers) || customers.length === 0) {
        return { expired: latest.length, enforced: 0 };
      }

      // Map customers by id for fast lookup; then group by tenant
      const custById = new Map(customers.map((c) => [String(c._id), c]));
      const byTenant = new Map();
      for (const row of latest) {
        const idStr = String(row._id);
        const cust = custById.get(idStr);
        if (!cust) continue; // not a static customer or missing
        const tid = String(cust.tenantId || row.tenantId || '');
        if (!byTenant.has(tid)) byTenant.set(tid, []);
        byTenant.get(tid).push(cust);
      }

      let enforcedCount = 0;

      // Process each tenant group serially (but each tenant uses its own queue)
      for (const [tenantId, custList] of byTenant.entries()) {
        // iterate customers sequentially to avoid hammering the tenant router
        for (const cust of custList) {
          try {
            // mark inactive in DB
            await Customer.updateOne({ _id: cust._id }, { $set: { status: 'inactive', updatedAt: new Date() } }).catch(() => {});
            // enqueue disableCustomerQueue in tenant queue with retries
            await enqueueTenantTask(tenantId, async () => {
              // wrap the actual call so executeWithRetries can retry if transient
              await disableCustomerQueue(cust).catch((err) => {
                // surface non-transient errors to be handled by executeWithRetries
                throw err;
              });
            }).catch((err) => {
              console.warn('[expireStatic] disableCustomerQueue failed after retries', { tenantId, account: cust.accountNumber, err: String(err?.message || err) });
            });
            enforcedCount += 1;
          } catch (err) {
            console.warn('[expireStatic] per-customer enforcement error', { tenantId, account: cust.accountNumber, err: String(err?.message || err) });
          }
        }
      }

      return { expired: latest.length, enforced: enforcedCount };
    } catch (err) {
      console.error('[expireStatic] job error', String(err?.message || err));
      return { expired: 0, enforced: 0, error: String(err?.message || err) };
    }
  }
});
