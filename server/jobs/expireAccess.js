'use strict';

/**
 * Expire router access (Hotspot + ad-hoc PPPoE vouchers)
 * ------------------------------------------------------
 * Finds records whose `expiresAt` is in the past, removes the corresponding
 * MikroTik entries, clears active sessions, and deletes the record.
 *
 * Revisions:
 * - Per-tenant task queue to avoid parallel bursts at the same router
 * - Retries with exponential backoff for transient RouterOS/network errors
 * - Larger timeouts for potentially heavy prints (hotspot/ppp lists)
 * - Defensive logging and non-throwing behavior so sweep won't crash
 */

const RegisteredHotspotUser = require('../models/RegisteredHotspotUser');
const RegisteredPPPoEUser = require('../models/pppoeUsers');
const { sendCommand } = require('../utils/mikrotikConnectionManager');
const { scheduleJob } = require('../utils/scheduler');

const ROUTER_TIMEOUT_MS = 10_000;
const HEAVY_TIMEOUT_MS = 30_000;

const TENANT_CONCURRENCY = 1;
const INTER_TASK_DELAY_MS = 200;
const RETRY_COUNT = 3;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 10_000;

const getId = (row) => (row ? row['.id'] || row.id || row.numbers || null : null);
const toTenantId = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && typeof value.toString === 'function') return value.toString();
  return String(value);
};

function logCommandError(label, context, err) {
  console.warn(`[expireAccess] ${label}`, {
    ...context,
    error: err?.message || err,
  });
}

function isTransientErr(err) {
  if (!err) return false;
  const s = String(err?.message || err || '').toLowerCase();
  return /timeout|unknownreply|!empty|econn|ehost|network|connect|reset/i.test(s);
}

/* ------------------ lightweight per-tenant queue ------------------ */
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
      console.warn('[expireAccess] tenant queue processor error', e?.message || e);
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
    const result = await executeWithRetries(item.taskFn);
    item.resolve(result);
  } catch (err) {
    item.reject(err);
  } finally {
    q.running -= 1;
    setTimeout(() => processTenantQueue(tenantId).catch(() => {}), INTER_TASK_DELAY_MS);
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
      console.warn(`[expireAccess] transient error (attempt ${attempt}) — backing off ${backoff}ms:`, String(err?.message || err));
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr || new Error('operation failed after retries');
}

/* ------------------ remove helpers (wrapped per-tenant) ------------------ */

async function _removeHotspotUserTask(tenantId, mac) {
  if (!tenantId || !mac) return;
  const name = String(mac).trim();
  if (!name) return;

  // lookup and remove user object
  const list = await sendCommand('/ip/hotspot/user/print', [`?name=${name}`], { tenantId, timeoutMs: ROUTER_TIMEOUT_MS }).catch((err) => {
    logCommandError('hotspot user lookup failed', { tenantId, mac: name }, err);
    return [];
  });
  const row = Array.isArray(list) && list[0] ? list[0] : null;
  const id = getId(row);
  if (id) {
    await sendCommand('/ip/hotspot/user/remove', [`=numbers=${id}`], { tenantId, timeoutMs: ROUTER_TIMEOUT_MS }).catch((err) => {
      logCommandError('hotspot user remove failed', { tenantId, mac: name, id }, err);
    });
  }

  // find active sessions by user and by mac
  const activeByUser = await sendCommand('/ip/hotspot/active/print', [`?user=${name}`], { tenantId, timeoutMs: HEAVY_TIMEOUT_MS }).catch((err) => {
    logCommandError('hotspot active lookup by user failed', { tenantId, user: name }, err);
    return [];
  });
  const activeByMac = await sendCommand('/ip/hotspot/active/print', [`?mac-address=${name}`], { tenantId, timeoutMs: HEAVY_TIMEOUT_MS }).catch((err) => {
    logCommandError('hotspot active lookup by mac failed', { tenantId, mac: name }, err);
    return [];
  });

  const active = [
    ...(Array.isArray(activeByUser) ? activeByUser : []),
    ...(Array.isArray(activeByMac) ? activeByMac : []),
  ];

  const seen = new Set();
  for (const session of active) {
    const sessionId = getId(session);
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    await sendCommand('/ip/hotspot/active/remove', [`=.id=${sessionId}`], { tenantId, timeoutMs: ROUTER_TIMEOUT_MS }).catch((err) => {
      logCommandError('hotspot active remove failed', { tenantId, sessionId, mac: name }, err);
    });
  }
}

async function removeHotspotUser(tenantId, mac) {
  // enqueue per-tenant task (with retries)
  return enqueueTenantTask(tenantId, async () => {
    try {
      await _removeHotspotUserTask(tenantId, mac);
      return { ok: true };
    } catch (err) {
      logCommandError('removeHotspotUser failed', { tenantId, mac }, err);
      throw err;
    }
  }).catch((err) => {
    // swallow final failure but surface log
    logCommandError('queued removeHotspotUser failed', { tenantId, mac }, err);
    return { ok: false, err: String(err?.message || err) };
  });
}

async function _removePppoeUserTask(tenantId, username) {
  if (!tenantId || !username) return;
  const name = String(username).trim();
  if (!name) return;

  const secrets = await sendCommand('/ppp/secret/print', [`?name=${name}`], { tenantId, timeoutMs: HEAVY_TIMEOUT_MS }).catch((err) => {
    logCommandError('pppoe secret lookup failed', { tenantId, username: name }, err);
    return [];
  });

  const secret = Array.isArray(secrets) && secrets[0] ? secrets[0] : null;
  const secretId = getId(secret);
  if (secretId) {
    await sendCommand('/ppp/secret/remove', [`=numbers=${secretId}`], { tenantId, timeoutMs: ROUTER_TIMEOUT_MS }).catch((err) => {
      logCommandError('pppoe secret remove failed', { tenantId, username: name, secretId }, err);
    });
  }

  const active = await sendCommand('/ppp/active/print', [`?name=${name}`], { tenantId, timeoutMs: HEAVY_TIMEOUT_MS }).catch((err) => {
    logCommandError('pppoe active lookup failed', { tenantId, username: name }, err);
    return [];
  });

  for (const session of Array.isArray(active) ? active : []) {
    const sessionId = getId(session);
    if (!sessionId) continue;
    await sendCommand('/ppp/active/remove', [`=.id=${sessionId}`], { tenantId, timeoutMs: ROUTER_TIMEOUT_MS }).catch((err) => {
      logCommandError('pppoe active remove failed', { tenantId, username: name, sessionId }, err);
    });
  }
}

async function removePppoeUser(tenantId, username) {
  return enqueueTenantTask(tenantId, async () => {
    try {
      await _removePppoeUserTask(tenantId, username);
      return { ok: true };
    } catch (err) {
      logCommandError('removePppoeUser failed', { tenantId, username }, err);
      throw err;
    }
  }).catch((err) => {
    logCommandError('queued removePppoeUser failed', { tenantId, username }, err);
    return { ok: false, err: String(err?.message || err) };
  });
}

/* ------------------ main sweep ------------------ */

async function runExpirySweep() {
  const now = new Date();
  const summary = {
    hotspotExpired: 0,
    hotspotDisconnected: 0,
    hotspotErrors: 0,
    pppoeExpired: 0,
    pppoeDisconnected: 0,
    pppoeErrors: 0,
  };

  // Hotspot expiries
  let hotspot = [];
  try {
    hotspot = await RegisteredHotspotUser.find({ expiresAt: { $lte: now } })
      .select('_id tenantId mac')
      .lean()
      .catch(() => []);
    summary.hotspotExpired = Array.isArray(hotspot) ? hotspot.length : 0;
  } catch (err) {
    hotspot = [];
    summary.hotspotExpired = 0;
    console.warn('[expireAccess] failed fetching hotspot expiries', String(err?.message || err));
  }

  // Process hotspot entries — use queued removal so per-tenant serialization happens
  for (const entry of hotspot || []) {
    const tenantId = toTenantId(entry.tenantId);
    if (!tenantId || !entry.mac) {
      summary.hotspotErrors += 1;
      console.warn('[expireAccess] hotspot record missing tenant or mac', {
        id: entry._id?.toString?.() || entry._id,
        tenantId,
        mac: entry.mac,
      });
      continue;
    }
    try {
      const res = await removeHotspotUser(tenantId, entry.mac);
      // attempt to delete record even if router ops partially failed
      await RegisteredHotspotUser.deleteOne({ _id: entry._id }).catch(() => {});
      if (res && res.ok) {
        summary.hotspotDisconnected += 1;
      } else {
        summary.hotspotErrors += 1;
      }
    } catch (err) {
      summary.hotspotErrors += 1;
      console.warn('[expireAccess] hotspot disconnect failed', {
        tenantId,
        mac: entry.mac,
        error: err?.message || err,
      });
    }
  }

  // PPPoE expiries
  let pppoe = [];
  try {
    pppoe = await RegisteredPPPoEUser.find({ expiresAt: { $lte: now } })
      .select('_id tenantId username')
      .lean()
      .catch(() => []);
    summary.pppoeExpired = Array.isArray(pppoe) ? pppoe.length : 0;
  } catch (err) {
    pppoe = [];
    summary.pppoeExpired = 0;
    console.warn('[expireAccess] failed fetching pppoe expiries', String(err?.message || err));
  }

  for (const entry of pppoe || []) {
    const tenantId = toTenantId(entry.tenantId);
    if (!tenantId || !entry.username) {
      summary.pppoeErrors += 1;
      console.warn('[expireAccess] pppoe record missing tenant or username', {
        id: entry._id?.toString?.() || entry._id,
        tenantId,
        username: entry.username,
      });
      continue;
    }
    try {
      const res = await removePppoeUser(tenantId, entry.username);
      await RegisteredPPPoEUser.deleteOne({ _id: entry._id }).catch(() => {});
      if (res && res.ok) {
        summary.pppoeDisconnected += 1;
      } else {
        summary.pppoeErrors += 1;
      }
    } catch (err) {
      summary.pppoeErrors += 1;
      console.warn('[expireAccess] pppoe disconnect failed', {
        tenantId,
        username: entry.username,
        error: err?.message || err,
      });
    }
  }

  console.log('[expireAccess] sweep summary', summary);
  return summary;
}

scheduleJob({
  name: 'expireAccess',
  cronExpr: '*/5 * * * *',
  task: runExpirySweep,
});

module.exports = { runExpirySweep };
