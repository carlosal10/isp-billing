// utils/mikrotik.js
'use strict';

// Tenant-scoped MikroTik helpers built on the pooled connection manager.
// Make sure your routes pass req.tenantId into these helpers.

const { sendCommand, getStatus } = require("./mikrotikConnectionManager"); // ← correct path

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
  // sometimes library returns a single object or string - try to wrap
  if (typeof res === "object") return [res];
  return [];
}

/**
 * safeSend - wrapper around sendCommand that:
 *  - retries on transient parse/network errors like '!empty' or timeouts
 *  - treats auth errors as non-retriable
 *  - returns normalized rows or throws
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
      // catch odd textual replies from underlying lib
      const raw = (typeof res === "string") ? res : JSON.stringify(res || "");
      if (TRANSIENT_REPLY_RE.test(raw)) {
        throw new Error(`malformed_reply:${raw.slice(0, 200)}`);
      }
      return res;
    } catch (err) {
      lastErr = err;
      const msg = String(err && (err.message || err) || "");
      // auth errors -> rethrow immediately (non-transient)
      if (AUTH_ERR_RE.test(msg)) {
        // bubble auth error quickly so callers may update credentials
        console.error(`mikrotik auth error: ${msg}`);
        throw err;
      }
      // If last attempt, rethrow
      if (attempt > retries) break;
      // else small backoff
      const backoff = startBackoff * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  // augment error
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
    // transient parser issues may be treated as "not found" depending on caller semantics
    // rethrow auth errors, otherwise surface as operational error
    const msg = String(err && (err.message || err) || "");
    if (/auth/i.test(msg)) throw err;
    // log and continue with empty result
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
  // fall back: some libs return string like "added id=XYZ" - ignore for now
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
    // If parser returned !empty treat as empty set (fail-open)
    if (TRANSIENT_REPLY_RE.test(msg)) {
      return { ok: true, users: [], count: 0 };
    }
    // rethrow otherwise
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
      const res = await safeSend("/ppp/active/print", args, opts).catch((e) => { throw e; });
      const rows = normalizeRows(res);
      if (!rows.length) break;
      all.push(...rows);
      if (rows.length < bundleSize) break; // last page
      offset += bundleSize;
      // small pause to avoid hammering router (and let per-entry queue drain)
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    } catch (err) {
      const msg = String(err && (err.message || err) || '');
      // treat well-known parser/no-data responses as end-of-data
      if (TRANSIENT_REPLY_RE.test(msg)) {
        break;
      }
      // for other transient errors, log and break to avoid long loops
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
};
