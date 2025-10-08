'use strict';

/**
 * Expire router access (Hotspot + ad-hoc PPPoE vouchers)
 * ------------------------------------------------------
 * Finds records whose `expiresAt` is in the past, removes the corresponding
 * MikroTik entries, clears active sessions, and deletes the record.
 *
 * This replaces the legacy direct connect logic with the shared pooled
 * MikroTik connection manager so multi-tenant routing works correctly.
 */

const RegisteredHotspotUser = require('../models/RegisteredHotspotUser');
const RegisteredPPPoEUser = require('../models/pppoeUsers');
const { sendCommand } = require('../utils/mikrotikConnectionManager');
const { scheduleJob } = require('../utils/scheduler');

const ROUTER_TIMEOUT_MS = 10_000;

const getId = (row) => (row ? row['.id'] || row.id || row.numbers || null : null);
const toTenantId = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && typeof value.toString === 'function') return value.toString();
  return String(value);
};

async function removeHotspotUser(tenantId, mac) {
  if (!tenantId || !mac) return;

  const name = String(mac).trim();
  if (!name) return;

  const list = await sendCommand('/ip/hotspot/user/print', [`?name=${name}`], {
    tenantId,
    timeoutMs: ROUTER_TIMEOUT_MS,
  }).catch(() => []);

  const row = Array.isArray(list) && list[0] ? list[0] : null;
  const id = getId(row);
  if (id) {
    await sendCommand('/ip/hotspot/user/remove', [`=numbers=${id}`], {
      tenantId,
      timeoutMs: ROUTER_TIMEOUT_MS,
    }).catch(() => {});
  }

  const activeByUser = await sendCommand('/ip/hotspot/active/print', [`?user=${name}`], {
    tenantId,
    timeoutMs: ROUTER_TIMEOUT_MS,
  }).catch(() => []);

  const activeByMac = await sendCommand('/ip/hotspot/active/print', [`?mac-address=${name}`], {
    tenantId,
    timeoutMs: ROUTER_TIMEOUT_MS,
  }).catch(() => []);

  const active = [
    ...(Array.isArray(activeByUser) ? activeByUser : []),
    ...(Array.isArray(activeByMac) ? activeByMac : []),
  ];

  const seen = new Set();
  for (const session of active) {
    const sessionId = getId(session);
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    await sendCommand('/ip/hotspot/active/remove', [`=.id=${sessionId}`], {
      tenantId,
      timeoutMs: ROUTER_TIMEOUT_MS,
    }).catch(() => {});
  }
}

async function removePppoeUser(tenantId, username) {
  if (!tenantId || !username) return;

  const name = String(username).trim();
  if (!name) return;

  const secrets = await sendCommand('/ppp/secret/print', [`?name=${name}`], {
    tenantId,
    timeoutMs: ROUTER_TIMEOUT_MS,
  }).catch(() => []);

  const secret = Array.isArray(secrets) && secrets[0] ? secrets[0] : null;
  const secretId = getId(secret);
  if (secretId) {
    await sendCommand('/ppp/secret/remove', [`=numbers=${secretId}`], {
      tenantId,
      timeoutMs: ROUTER_TIMEOUT_MS,
    }).catch(() => {});
  }

  const active = await sendCommand('/ppp/active/print', [`?name=${name}`], {
    tenantId,
    timeoutMs: ROUTER_TIMEOUT_MS,
  }).catch(() => []);

  for (const session of Array.isArray(active) ? active : []) {
    const sessionId = getId(session);
    if (!sessionId) continue;
    await sendCommand('/ppp/active/remove', [`=.id=${sessionId}`], {
      tenantId,
      timeoutMs: ROUTER_TIMEOUT_MS,
    }).catch(() => {});
  }
}

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

  const hotspot = await RegisteredHotspotUser.find({ expiresAt: { $lte: now } })
    .select('_id tenantId mac')
    .lean();
  summary.hotspotExpired = hotspot.length;

  for (const entry of hotspot) {
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
      await removeHotspotUser(tenantId, entry.mac);
      await RegisteredHotspotUser.deleteOne({ _id: entry._id }).catch(() => {});
      summary.hotspotDisconnected += 1;
    } catch (err) {
      summary.hotspotErrors += 1;
      console.warn('[expireAccess] hotspot disconnect failed', {
        tenantId,
        mac: entry.mac,
        error: err?.message || err,
      });
    }
  }

  let pppoe = [];
  try {
    pppoe = await RegisteredPPPoEUser.find({ expiresAt: { $lte: now } })
      .select('_id tenantId username')
      .lean();
  } catch (err) {
    // In legacy setups the schema may not have expiresAt; treat as none.
    pppoe = [];
  }
  summary.pppoeExpired = Array.isArray(pppoe) ? pppoe.length : 0;

  for (const entry of Array.isArray(pppoe) ? pppoe : []) {
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
      await removePppoeUser(tenantId, entry.username);
      await RegisteredPPPoEUser.deleteOne({ _id: entry._id }).catch(() => {});
      summary.pppoeDisconnected += 1;
    } catch (err) {
      summary.pppoeErrors += 1;
      console.warn('[expireAccess] pppoe disconnect failed', {
        tenantId,
        username: entry.username,
        error: err?.message || err,
      });
    }
  }

  return summary;
}

scheduleJob({
  name: 'expireAccess',
  cronExpr: '*/5 * * * *',
  task: runExpirySweep,
});

module.exports = { runExpirySweep };
