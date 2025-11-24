// utils/mikrotik.js
'use strict';

// Tenant-scoped MikroTik helpers built on the pooled connection manager.
// Make sure your routes pass req.tenantId into these helpers.

const { sendCommand, getStatus, forceReconnect } = require("./mikrotikConnectionManager"); // ← updated to include forceReconnect

// RouterOS word helpers
const qs = (k, v) => `?${k}=${v}`;
const w  = (k, v) => `=${k}=${v}`;

const TRANSIENT_REPLY_RE = /!empty|UNKNOWNREPLY|!done/i;
const AUTH_ERR_RE = /username|password|authentication|login failure|invalid user/i;
const DEFAULT_SEND_RETRIES = 2;
const DEFAULT_SEND_BACKOFF_MS = 250;

// --- helpers --------------------------------------------------------------

function extractId(row) {
  if (!row) return undefined;
  return row[".id"] || row.id || row.numbers || row[".numbers"] || undefined;
}

function isArrayLike(v) {
  return Array.isArray(v);
}

function normalizeRows(res) {
  // routeros-client often returns array of objects on print; keep that
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (typeof res === "object") return [res];
  return [];
}

/**
 * safeSend - wrapper around sendCommand that:
 *  - retries on transient parse/network errors like '!empty' or timeouts
 *  - retries when pool queue is full (QUEUE_FULL) with backoff
 *  - treats auth errors as non-retriable
 *  - returns raw sendCommand result (caller normalizes) or throws
 */
async function safeSend(path, words = [], options = {}) {
  const retries = options.retries ?? DEFAULT_SEND_RETRIES;
  const startBackoff = options.backoffMs ?? DEFAULT_SEND_BACKOFF_MS;
  let attempt = 0;
  let lastErr;

  while (attempt <= retries) {
    attempt++;
    try {
      const res = await sendCommand(path, words, options);

      // Evaluate raw reply for transient textual markers.
      // Avoid JSON.stringify on large objects — inspect string/primitive or join array->string.
      let rawForTest = "";
      if (typeof res === "string") rawForTest = res;
      else if (Array.isArray(res)) rawForTest = res.map(r => (typeof r === 'string' ? r : JSON.stringify(r))).join(' ');
      else if (res && typeof res === 'object') rawForTest = Object.values(res).map(v => (typeof v === 'string' ? v : '')).join(' ');
      else rawForTest = String(res || "");

      if (TRANSIENT_REPLY_RE.test(rawForTest)) {
        // treat as transient malformed reply
        const e = new Error(`malformed_reply:${(rawForTest || "").slice(0, 200)}`);
        e.code = 'MALFORMED_REPLY';
        throw e;
      }

      return res;
    } catch (err) {
      lastErr = err;
      const msg = String(err && (err.message || err) || "");

      // Auth errors -> rethrow immediately (caller may need to refresh credentials)
      if (AUTH_ERR_RE.test(msg)) {
        console.error(`mikrotik auth error: ${msg}`);
        // Optionally trigger forceReconnect for the tenant/server if caller requests it elsewhere.
        throw err;
      }

      // Queue full from connection manager -> retry with backoff (this is transient)
      if (err && err.code === 'QUEUE_FULL' || /queue full|command queue full|Router busy/i.test(msg)) {
        if (attempt > retries) break;
        const backoff = startBackoff * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      // Other transient parser/network errors (malformed_reply, Timeout etc) -> retry
      if (attempt > retries) break;

      const backoff = startBackoff * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }
  }

  const e = new Error(`safeSend failed: ${String(lastErr?.message || lastErr || 'unknown')}`);
  e.cause = lastErr;
  throw e;
}

// --- API functions -------------------------------------------------------

/**
 * Ensure (create or update) a Hotspot user.
 * - If user exists, update password/profile/server/mac-address (only if provided).
 * - If not, create it.
 */
async function ensureHotspotUser(tenantId, opts) {
  if (!tenantId) throw new Error("ensureHotspotUser: missing tenantId");
  const { username, password, profile, server, macAddress, comment } = opts || {};
  if (!username || !password) throw new Error("username and password are required");

  // 1) Look up existing user
  let found;
  try {
    found = await safeSend("/ip/hotspot/user/print", [qs("name", username)], { tenantId, timeoutMs: 10000 });
  } catch (err) {
    const msg = String(err && (err.message || err) || "");
    if (AUTH_ERR_RE.test(msg)) throw err; // bubble auth errors
    console.warn(`ensureHotspotUser: lookup transient error for ${username}: ${msg}`);
    found = [];
  }

  const exists = Array.isArray(found) && found.length > 0;
  const id = exists ? extractId(found[0]) : null;

  if (exists && id) {
    // 2a) Update existing (only fields provided)
    const words = [w("numbers", id)];
    if (password)    words.push(w("password", password));
    if (profile)     words.push(w("profile", profile));
    if (server)      words.push(w("server", server));
    if (macAddress)  words.push(w("mac-address", macAddress));
    if (comment)     words.push(w("comment", comment));

    if (words.length > 1) {
      await safeSend("/ip/hotspot/user/set", words, { tenantId, timeoutMs: 10000 });
    }
    return { ok: true, updated: true, created: false, id };
  }

  // 2b) Create new
  const add = [
    w("name", username),
    w("password", password),
  ];
  if (profile)    add.push(w("profile", profile));
  if (server)     add.push(w("server", server));
  if (macAddress) add.push(w("mac-address", macAddress));
  if (comment)    add.push(w("comment", comment));

  const res = await safeSend("/ip/hotspot/user/add", add, { tenantId, timeoutMs: 10000 });
  // routeros-client may return added .ret or array; try to extract ID robustly
  let newId;
  if (Array.isArray(res) && res.length && extractId(res[0])) newId = extractId(res[0]);
  else if (res && extractId(res)) newId = extractId(res);
  return { ok: true, updated: false, created: true, id: newId };
}

/**
 * Get currently active Hotspot sessions.
 */
async function getHotspotActive(tenantId) {
  if (!tenantId) throw new Error("getHotspotActive: missing tenantId");
  try {
    const rows = await safeSend("/ip/hotspot/active/print", [], { tenantId, timeoutMs: 10000 });
    const users = normalizeRows(rows);
    return { ok: true, users, count: users.length };
  } catch (err) {
    const msg = String(err && (err.message || err) || "");
    if (TRANSIENT_REPLY_RE.test(msg)) {
      return { ok: true, users: [], count: 0 };
    }
    throw err;
  }
}

/**
 * Get currently active PPPoE sessions.
 * Uses chunking to avoid single huge queries; low-impact delays between pages.
 */
async function getPPPoEActive(tenantId) {
  if (!tenantId) throw new Error("getPPPoEActive: missing tenantId");

  const opts = { tenantId, timeoutMs: 10000 };
  const bundleSize = 10;
  const delayMs = 200;
  const all = [];
  let offset = 0;
  const maxPages = 200; // safety guard

  for (let page = 0; page < maxPages; page++) {
    try {
      const args = [`=limit=${bundleSize}`, `=offset=${offset}`];
      const res = await safeSend("/ppp/active/print", args, opts);
      const rows = normalizeRows(res);
      if (!rows.length) break;
      all.push(...rows);
      if (rows.length < bundleSize) break; // last page
      offset += bundleSize;
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    } catch (err) {
      const msg = String(err && (err.message || err) || '');
      if (TRANSIENT_REPLY_RE.test(msg)) {
        break;
      }
      // If queue-full was the reason, let caller know partial and continue gracefully.
      if (err && err.code === 'QUEUE_FULL') {
        console.warn('getPPPoEActive: partial result due to router busy (QUEUE_FULL)');
        break;
      }
      console.warn('getPPPoEActive chunk error:', msg);
      break;
    }
  }

  return { ok: true, users: all, count: all.length };
}

/**
 * Expose current connection pool status (filtered to this tenant).
 */
function getMikrotikStatusForTenant(tenantId) {
  const all = getStatus();
  return all.filter(s => s.tenantId === tenantId);
}

module.exports = {
  ensureHotspotUser,
  getHotspotActive,
  getPPPoEActive,
  getMikrotikStatusForTenant,
  // expose for admin tooling if needed:
  forceReconnect,
};
