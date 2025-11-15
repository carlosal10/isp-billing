'use strict';

/**
 * routes/enforce.js (revised)
 *
 * Enforce router-side disconnection for customers flagged inactive/expired.
 * - STATIC: disable queue + block address list (handled also by expireStatic, but we ensure here too)
 * - PPPoE: disable secret and kick active session if present
 *
 * Improvements:
 * - per-tenant serial queue (prevent concurrent bursts at a single router)
 * - retries with exponential backoff for transient errors
 * - configurable timeouts for heavy RouterOS commands
 * - small inter-task delay to avoid back-to-back spikes
 * - robust, non-throwing logging
 */

const cron = require('node-cron');
const Customer = require('../models/customers');
const { sendCommand } = require('../utils/mikrotikConnectionManager');
const { disableCustomerQueue } = require('../utils/mikrotikBandwidthManager');
const { releaseIp } = require('../utils/staticIpPool');
const Tenant = require('../models/Tenant');

// Tunables
const DEFAULT_TIMEOUT_MS = 15_000;     // baseline for small prints
const HEAVY_TIMEOUT_MS = 30_000;       // for potentially large prints (hotspot/ppp secrets/active)
const TENANT_CONCURRENCY = 1;          // serial per tenant
const INTER_TASK_DELAY_MS = 200;       // ms between tasks for the same tenant
const RETRY_COUNT = 3;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 10_000;

// Basic transient error detector
function isTransientErr(err) {
  if (!err) return false;
  const s = String(err?.message || err || '').toLowerCase();
  return /timeout|unknownreply|!empty|econn|ehost|network|connect|reset/i.test(s);
}

// Lightweight per-tenant queue so we don't hammer the same router
const tenantQueues = new Map();

function enqueueTenantTask(tenantId, taskFn) {
  if (!tenantId) {
    // no tenant => just execute with retries
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
      console.warn('[enforce] tenant queue processor error', e?.message || e);
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
    setTimeout(() => {
      processTenantQueue(tenantId).catch(() => {});
    }, INTER_TASK_DELAY_MS);
  }
}

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
      console.warn(`[enforce] transient error (attempt ${attempt}) — backing off ${backoff}ms:`, String(err?.message || err));
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr || new Error('operation failed after retries');
}

/**
 * Disable PPPoE secret and kick active session for a customer.
 * - uses candidate names from accountNumber + aliases
 * - uses larger timeouts for potential big result sets
 * - operations run via sendCommand and are wrapped with retries where appropriate
 */
async function enforcePppoe(tenantId, customer) {
  const candidates = new Set();
  if (customer?.accountNumber) candidates.add(String(customer.accountNumber).trim());
  if (Array.isArray(customer?.accountAliases)) {
    for (const a of customer.accountAliases) {
      if (!a) continue;
      candidates.add(String(a).trim());
    }
  }
  if (candidates.size === 0) return { found: false };

  // Task to be enqueued per-tenant
  return enqueueTenantTask(tenantId, async () => {
    let foundAny = false;
    for (const name of candidates) {
      try {
        // fetch secrets for name (heavy)
        const secrets = await sendCommand('/ppp/secret/print', [`?name=${name}`], { tenantId, timeoutMs: HEAVY_TIMEOUT_MS }).catch((e) => { throw e; });
        if (!Array.isArray(secrets) || !secrets[0]) {
          // no secret under this name — continue to next candidate
          continue;
        }

        const row = secrets[0];
        const id = row['.id'] ?? row.id ?? row.numbers;
        if (id) {
          // disable secret
          await sendCommand('/ppp/secret/set', [`=numbers=${id}`, `=disabled=yes`], { tenantId, timeoutMs: DEFAULT_TIMEOUT_MS }).catch((e) => { throw e; });
        }

        // attempt to find active session and remove it (heavy, but for a single name)
        const act = await sendCommand('/ppp/active/print', [`?name=${name}`], { tenantId, timeoutMs: HEAVY_TIMEOUT_MS }).catch((e) => { throw e; });
        if (Array.isArray(act) && act[0]) {
          const aid = act[0]['.id'] ?? act[0].id ?? act[0].numbers;
          if (aid) {
            await sendCommand('/ppp/active/remove', [`=.id=${aid}`], { tenantId, timeoutMs: DEFAULT_TIMEOUT_MS }).catch((e) => { throw e; });
          }
        }

        foundAny = true;
        // done for this customer
        break;
      } catch (err) {
        // If transient, let executeWithRetries handle retrying the entire tenant task.
        // If non-transient, log and move to next candidate.
        if (isTransientErr(err)) {
          // bubble up so executeWithRetries will retry
          throw err;
        } else {
          console.warn('[enforce] enforcePppoe non-transient error for candidate', { tenantId, name, err: String(err?.message || err) });
          // continue to next candidate
        }
      }
    }

    if (!foundAny) {
      console.log('[enforce] PPPoE enforce: no secret found for customer', { tenantId, id: customer._id, account: customer.accountNumber });
    }
    return { found: foundAny };
  }).catch((err) => {
    // queue-level failure (after retries)
    console.warn('[enforce] queued enforcePppoe failed', { tenantId, account: customer.accountNumber, err: String(err?.message || err) });
    return { found: false, err: String(err?.message || err) };
  });
}

/**
 * Disable bandwidth queue for a static customer.
 * Wraps disableCustomerQueue in tenant queue and retries.
 */
async function enforceStatic(tenantId, customer) {
  return enqueueTenantTask(tenantId, async () => {
    try {
      await disableCustomerQueue(customer).catch((e) => { throw e; });
      // release IP back to pool best-effort (not critical)
      try {
        const tenantDoc = await Tenant.findById(customer.tenantId).lean();
        if (tenantDoc && customer?.staticConfig?.ip) {
          await releaseIp(tenantDoc, customer.staticConfig.ip).catch(() => {});
        }
      } catch (e) {
        // ignore
      }
      return { ok: true };
    } catch (err) {
      if (isTransientErr(err)) throw err;
      console.warn('[enforce] enforceStatic non-transient error', { tenantId, account: customer.accountNumber, err: String(err?.message || err) });
      return { ok: false, err: String(err?.message || err) };
    }
  }).catch((err) => {
    console.warn('[enforce] queued enforceStatic failed', { tenantId, account: customer.accountNumber, err: String(err?.message || err) });
    return { ok: false, err: String(err?.message || err) };
  });
}

/**
 * runOnce: main enforcement pass
 * - marks newly expired customers as inactive (DB)
 * - then enforces per-tenant using enqueueTenantTask (serialization + retries)
 */
async function runOnce() {
  const now = new Date();

  // 1) mark newly expired customers as inactive (safe DB-only op)
  try {
    const newly = await Customer.find({
      expiryDate: { $lt: now },
      status: { $nin: ['inactive', 'expired'] },
    }).select('_id tenantId accountNumber accountAliases connectionType staticConfig').lean().catch(() => []);

    if (Array.isArray(newly) && newly.length) {
      for (const c of newly) {
        try {
          await Customer.updateOne({ _id: c._id }, { $set: { status: 'inactive', updatedAt: now } }).catch(() => {});
        } catch {}
      }
      console.log('[enforce] marked newly expired customers inactive:', newly.length);
    }
  } catch (e) {
    console.warn('[enforce] marking expired failed:', String(e?.message || e));
  }

  // 2) fetch all customers that should be enforced
  let tenants;
  try {
    tenants = await Customer.distinct('tenantId').catch(() => []);
  } catch (e) {
    tenants = [];
  }

  let totalStatic = 0;
  let totalPppoe = 0;

  for (const tid of tenants || []) {
    const tenantId = String(tid);
    try {
      // gather inactive/expired customers for this tenant
      let list = await Customer.find({ tenantId, status: { $in: ['inactive', 'expired'] } })
        .select('_id tenantId accountNumber accountAliases connectionType staticConfig')
        .lean()
        .catch(() => []);

      // enforce sequentially per customer to avoid bursts (these will be queued per-tenant)
      for (const c of list) {
        try {
          if (c.connectionType === 'pppoe') {
            await enforcePppoe(tenantId, c);
            totalPppoe += 1;
          } else if (c.connectionType === 'static') {
            await enforceStatic(tenantId, c);
            totalStatic += 1;
          } else {
            // unknown types are skipped
          }
        } catch (err) {
          // shouldn't reach here because enforce* swallow, but log just in case
          console.warn('[enforce] per-customer enforcement error', { tenantId, id: c._id, err: String(err?.message || err) });
        }
      }

      console.log('[enforce] tenant enforcement summary', { tenantId, staticEnforced: totalStatic, pppoeEnforced: totalPppoe });
    } catch (err) {
      console.warn('[enforce] per-tenant error', { tenantId, err: String(err?.message || err) });
    }
  }

  return { tenants: tenants.length, staticEnforced: totalStatic, pppoeEnforced: totalPppoe };
}

// Schedule every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  try {
    const out = await runOnce();
    console.log('[enforce] cycle done', out);
  } catch (e) {
    console.error('[enforce] cycle error', e?.message || e);
  }
});

console.log('[enforce] inactive customers enforcement scheduled (*/5)');

module.exports = {};
