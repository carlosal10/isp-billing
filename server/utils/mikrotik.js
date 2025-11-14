// utils/mikrotik.js
// Tenant-scoped MikroTik helpers built on the pooled connection manager.
// Make sure your routes pass req.tenantId into these helpers.

const { sendCommand, getStatus } = require("./mikrotikConnectionManager"); // ← correct path

// RouterOS word helpers
const qs = (k, v) => `?${k}=${v}`;
const w  = (k, v) => `=${k}=${v}`;

/**
 * Ensure (create or update) a Hotspot user.
 * - If user exists, update password/profile/server/mac-address (only if provided).
 * - If not, create it.
 *
 * @param {string} tenantId
 * @param {{
 *   username: string,
 *   password: string,
 *   profile?: string,
 *   server?: string,
 *   macAddress?: string,
 *   comment?: string
 * }} opts
 * @returns {Promise<{ok: boolean, updated: boolean, created: boolean, id?: string}>}
 */
async function ensureHotspotUser(tenantId, opts) {
  if (!tenantId) throw new Error("ensureHotspotUser: missing tenantId");
  const { username, password, profile, server, macAddress, comment } = opts || {};
  if (!username || !password) throw new Error("username and password are required");

  // 1) Look up existing user
  const found = await sendCommand(
    "/ip/hotspot/user/print",
    [qs("name", username)],
    { tenantId, timeoutMs: 10000 }
  );

  const exists = Array.isArray(found) && found.length > 0;
  const id = exists ? (found[0][".id"] || found[0].id || found[0].numbers) : null;

  if (exists && id) {
    // 2a) Update existing (only fields provided)
    const words = [w("numbers", id)];
    if (password)    words.push(w("password", password));
    if (profile)     words.push(w("profile", profile));
    if (server)      words.push(w("server", server));
    if (macAddress)  words.push(w("mac-address", macAddress));
    if (comment)     words.push(w("comment", comment));

    if (words.length > 1) {
      await sendCommand("/ip/hotspot/user/set", words, { tenantId, timeoutMs: 10000 });
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

  const res = await sendCommand("/ip/hotspot/user/add", add, { tenantId, timeoutMs: 10000 });
  const newId = Array.isArray(res) && res[0] ? (res[0][".id"] || res[0].id || res[0].numbers) : undefined;
  return { ok: true, updated: false, created: true, id: newId };
}

/**
 * Get currently active Hotspot sessions.
 * @param {string} tenantId
 * @returns {Promise<{ok:boolean, users:any[], count:number}>}
 */
async function getHotspotActive(tenantId) {
  if (!tenantId) throw new Error("getHotspotActive: missing tenantId");
  const rows = await sendCommand("/ip/hotspot/active/print", [], { tenantId, timeoutMs: 10000 });
  return { ok: true, users: Array.isArray(rows) ? rows : [], count: Array.isArray(rows) ? rows.length : 0 };
}

/**
 * Get currently active PPPoE sessions.
 * @param {string} tenantId
 * @returns {Promise<{ok:boolean, users:any[], count:number}>}
 */
async function getPPPoEActive(tenantId) {
  if (!tenantId) throw new Error("getPPPoEActive: missing tenantId");
  // Chunked fetch to avoid large single queries that may timeout.
  const opts = { tenantId, timeoutMs: 10000 };
  const bundleSize = 10;
  const delayMs = 200;
  const all = [];
  let offset = 0;
  const maxPages = 200; // safety guard
  for (let page = 0; page < maxPages; page++) {
    try {
      const args = [`=limit=${bundleSize}`, `=offset=${offset}`];
      const res = await sendCommand("/ppp/active/print", args, opts).catch((e) => { throw e; });
      if (!Array.isArray(res) || res.length === 0) {
        // no more rows
        break;
      }
      all.push(...res);
      if (res.length < bundleSize) break; // last page
      offset += bundleSize;
      // small pause to avoid hammering router
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    } catch (err) {
      const msg = String(err && (err.message || err) || '');
      // treat !empty or similar parser/no-data responses as end-of-data
      if (/!empty|UNKNOWNREPLY|!done/i.test(msg)) {
        break;
      }
      // For other transient errors, log and break to avoid long loops
      console.warn('getPPPoEActive chunk error:', msg);
      break;
    }
  }
  return { ok: true, users: all, count: all.length };
}

/**
 * Expose current connection pool status (filtered to this tenant).
 * Useful for the Dashboard "connected" indicator.
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
