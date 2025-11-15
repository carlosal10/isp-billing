'use strict';

/**
 * Unified enforcement job: handles static, PPPoE and hotspot expirations in a
 * single sweep to avoid race conditions and provide an audit trail.
 *
 * Improvements:
 * - Serialize router-modifying calls per tenant (safe default concurrency = 1)
 * - Small delay between commands to avoid MikroTik overload
 * - Retries with exponential backoff on transient errors
 * - Graceful logging and error classification
 */

const { scheduleJob } = require('../utils/scheduler');
const { acquireLock, releaseLock } = require('../utils/jobLock');
const Customer = require('../models/customers');
const RegisteredHotspotUser = require('../models/RegisteredHotspotUser');
const RegisteredPPPoEUser = require('../models/pppoeUsers');
const { runExpirySweep } = require('./expireAccess');
const {
  disableCustomerQueue,
  removeCustomerQueue,
  disablePppoeSecret,
} = require('../utils/mikrotikBandwidthManager');
const { releaseIp } = require('../utils/staticIpPool');
const Tenant = require('../models/Tenant');

const LOCK_TTL = 4 * 60 * 1000; // 4 minutes (kept)
const TENANT_CONCURRENCY = 1; // number of concurrent router ops per tenant (1 = serial)
const INTER_TASK_DELAY_MS = 250; // delay between tasks for a given tenant
const OP_RETRY_COUNT = 3;
const OP_BASE_BACKOFF_MS = 500;
const OP_MAX_BACKOFF_MS = 10_000;

// Simple transient error matcher
function isTransientError(err) {
  if (!err) return false;
  const msg = String(err?.message || err || '').toLowerCase();
  return /timeout|unknownreply|!empty|econn|ehost|network|connect|reset/i.test(msg);
}

// Per-tenant queue implementation (lightweight)
const tenantQueues = new Map();
/**
 * enqueueTenantTask(tenantId, taskFn)
 * taskFn: async () => { ... } -> returns Promise
 */
function enqueueTenantTask(tenantId, taskFn) {
  if (!tenantId) {
    // fallback: run immediately but still with retries
    return executeWithRetries(taskFn);
  }

  let q = tenantQueues.get(tenantId);
  if (!q) {
    q = {
      running: 0,
      waiters: [], // array of { taskFn, resolve, reject }
    };
    tenantQueues.set(tenantId, q);
  }

  return new Promise((resolve, reject) => {
    q.waiters.push({ taskFn, resolve, reject });
    processTenantQueue(tenantId).catch((e) => {
      // log and swallow — each task will be rejected individually
      console.warn('[enforceAllExpired] tenant queue processor error', e?.message || e);
    });
  });
}

async function processTenantQueue(tenantId) {
  const q = tenantQueues.get(tenantId);
  if (!q) return;
  if (q.running >= TENANT_CONCURRENCY) return;
  const next = q.waiters.shift();
  if (!next) {
    // no work; cleanup map occasionally
    if (q.running === 0) tenantQueues.delete(tenantId);
    return;
  }

  q.running += 1;
  try {
    const result = await executeWithRetries(next.taskFn);
    next.resolve(result);
  } catch (err) {
    next.reject(err);
  } finally {
    q.running -= 1;
    // small delay before processing next to avoid bursting router
    setTimeout(() => {
      processTenantQueue(tenantId).catch(() => {});
    }, INTER_TASK_DELAY_MS);
  }
}

/**
 * executeWithRetries(fn)
 * retries transient errors with exponential backoff
 */
async function executeWithRetries(fn, opts = {}) {
  let attempt = 0;
  let lastErr = null;
  while (attempt < OP_RETRY_COUNT) {
    attempt += 1;
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientError(err) || attempt >= OP_RETRY_COUNT) {
        // non-transient or exhausted retries -> throw
        throw err;
      }
      const backoff = Math.min(OP_BASE_BACKOFF_MS * Math.pow(2, attempt - 1), OP_MAX_BACKOFF_MS);
      console.warn(`[enforceAllExpired] transient error (attempt ${attempt}) — backing off ${backoff}ms:`, String(err?.message || err));
      await new Promise((r) => setTimeout(r, backoff));
      // continue retrying
    }
  }
  throw lastErr || new Error('operation failed after retries');
}

async function runUnifiedEnforce() {
  const acquired = await acquireLock('enforceAllExpired', LOCK_TTL);
  if (!acquired) {
    console.log('[enforceAllExpired] another run is in progress; skipping');
    return { skipped: true };
  }

  const summary = {
    hotspot: { scanned: 0, removed: 0, errors: 0 },
    pppoe: { scanned: 0, disabled: 0, errors: 0 },
    static: { scanned: 0, disabled: 0, errors: 0 },
    customersMarkedInactive: 0,
  };

  try {
    // First, run the existing hotspot/registered-pppoe expiry sweep (removes vouchers)
    const sweep = await runExpirySweep().catch((e) => {
      console.warn('[enforceAllExpired] expireAccess sweep failed', e?.message || e);
      return null;
    });
    if (sweep) {
      summary.hotspot.scanned = sweep.hotspotExpired || 0;
      summary.hotspot.removed = sweep.hotspotDisconnected || 0;
      summary.hotspot.errors = sweep.hotspotErrors || 0;
      summary.pppoe.scanned = sweep.pppoeExpired || 0;
      summary.pppoe.disabled = sweep.pppoeDisconnected || 0;
      summary.pppoe.errors = sweep.pppoeErrors || 0;
    }

    // Find customers whose expiryDate passed and are not yet inactive/expired
    const now = new Date();
    const expiredCustomers = await Customer.find({ expiryDate: { $lt: now }, status: { $nin: ['inactive', 'expired'] } })
      .select('_id tenantId accountNumber accountAliases connectionType staticConfig')
      .lean()
      .catch(() => []);

    // Process sequentially but enqueue per-tenant to serialize router ops
    for (const c of expiredCustomers) {
      try {
        // mark inactive in DB immediately (non-blocking to router ops)
        await Customer.updateOne({ _id: c._id }, { $set: { status: 'inactive', updatedAt: new Date() } }).catch(() => {});
        summary.customersMarkedInactive += 1;

        const tenantId = String(c.tenantId || '');
        if (c.connectionType === 'pppoe') {
          // enqueue pppoe disable + queue disable as one tenant task
          await enqueueTenantTask(tenantId, async () => {
            try {
              // disable PPP secret (wrapped in retries)
              await disablePppoeSecret(c).catch((e) => { throw e; });
              // disable bandwidth queue (best-effort)
              await disableCustomerQueue(c).catch((e) => { throw e; });
              summary.pppoe.disabled += 1;
            } catch (err) {
              summary.pppoe.errors += 1;
              console.warn('[enforceAllExpired] failed disabling pppoe', { tenantId, account: c.accountNumber, err: err?.message || err });
              // rethrow to let executeWithRetries decide on retry
              throw err;
            }
          }).catch((err) => {
            // If queued task fails after retries, count as error (already incremented above)
            console.warn('[enforceAllExpired] queued pppoe task failed', { tenantId, account: c.accountNumber, err: err?.message || err });
          });
        } else if (c.connectionType === 'static') {
          await enqueueTenantTask(tenantId, async () => {
            try {
              // disable bandwidth queue
              await disableCustomerQueue(c).catch((e) => { throw e; });

              // release static IP back to pool (best-effort)
              try {
                const tenantDoc = await Tenant.findById(c.tenantId).lean();
                if (tenantDoc) await releaseIp(tenantDoc, c.staticConfig?.ip).catch(() => {});
              } catch (_) {
                // ignore release errors
              }

              summary.static.disabled += 1;
            } catch (err) {
              summary.static.errors += 1;
              console.warn('[enforceAllExpired] failed disabling static', { tenantId, account: c.accountNumber, err: err?.message || err });
              throw err;
            }
          }).catch((err) => {
            console.warn('[enforceAllExpired] queued static task failed', { tenantId, account: c.accountNumber, err: err?.message || err });
          });
        } else {
          // Unknown connection type — just mark inactive
        }
      } catch (err) {
        console.warn('[enforceAllExpired] failed to process expired customer', { id: c._id, err: err?.message || err });
      }
    }

    // Additionally, ensure any lingering disabled queues / lists are consistent
    // by scanning customers with status inactive/expired and re-applying disablement where necessary
    const inactiveList = await Customer.find({ status: { $in: ['inactive', 'expired'] } })
      .select('_id tenantId accountNumber accountAliases connectionType staticConfig')
      .lean()
      .catch(() => []);

    for (const c of inactiveList) {
      try {
        const tenantId = String(c.tenantId || '');
        await enqueueTenantTask(tenantId, async () => {
          try {
            if (c.connectionType === 'pppoe') {
              await disablePppoeSecret(c).catch((e) => { throw e; });
              await disableCustomerQueue(c).catch((e) => { throw e; });
            } else if (c.connectionType === 'static') {
              await disableCustomerQueue(c).catch((e) => { throw e; });
            }
          } catch (err) {
            // let outer executeWithRetries count/log as needed
            throw err;
          }
        }).catch(() => {
          // swallow — inactive enforcement is best-effort
        });
      } catch (err) {
        // swallow per-customer errors
      }
    }

    return summary;
  } finally {
    await releaseLock('enforceAllExpired').catch(() => {});
  }
}

// schedule every 5 minutes
scheduleJob({ name: 'enforceAllExpired', cronExpr: '*/5 * * * *', task: runUnifiedEnforce });

module.exports = { runUnifiedEnforce };
