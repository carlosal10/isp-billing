const { sendCommand } = require("../utils/mikrotikConnectionManager");

const routeCache = new Map();
const tenantConcurrent = new Map();
const MAX_PARALLEL_HEAVY = 2;
const AUTH_ERR_RE = /username|password|authentication|login failure|invalid user/i;

function setCache(key, value, ttlMs = 8_000) {
  routeCache.set(key, { at: Date.now(), ttlMs, value });
}

function getCache(key, maxStaleMs = 30_000) {
  const entry = routeCache.get(key);
  if (!entry) return null;

  const age = Date.now() - entry.at;
  if (age <= entry.ttlMs) return { value: entry.value, fresh: true, age };
  if (age <= entry.ttlMs + maxStaleMs) return { value: entry.value, fresh: false, age };

  routeCache.delete(key);
  return null;
}

async function acquireTenantSlot(tenantId, timeoutMs = 5_000) {
  const start = Date.now();

  while (true) {
    const current = tenantConcurrent.get(tenantId) || 0;
    if (current < MAX_PARALLEL_HEAVY) {
      tenantConcurrent.set(tenantId, current + 1);
      return;
    }

    if (Date.now() - start > timeoutMs) {
      throw new Error("Tenant busy");
    }

    await delay(80);
  }
}

function releaseTenantSlot(tenantId) {
  const current = tenantConcurrent.get(tenantId) || 0;
  if (current <= 1) tenantConcurrent.delete(tenantId);
  else tenantConcurrent.set(tenantId, current - 1);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function numberValue(value, defaultValue = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : defaultValue;
}

function stringValue(value, defaultValue = "") {
  return value == null ? defaultValue : String(value);
}

function qs(key, value) {
  return `?${key}=${value}`;
}

function w(key, value) {
  return `=${key}=${value}`;
}

function pickServerId(req) {
  return (
    req.headers["x-isp-server"] ||
    req.headers["x-router-id"] ||
    req.query?.serverId ||
    req.query?.server ||
    null
  );
}

function firstIpFromTarget(target) {
  if (!target) return "";
  const firstTarget = String(target).split(",")[0].trim();
  return firstTarget.split("/")[0].trim();
}

function isPrivateIPv4(ip) {
  try {
    const octets = ip.split(".").map(Number);
    if (octets[0] === 10) return true;
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    if (octets[0] === 192 && octets[1] === 168) return true;
    return false;
  } catch {
    return false;
  }
}

function mapPPPActiveRow(row = {}) {
  return {
    username: stringValue(row.name || row.user || row.username),
    address: stringValue(row.address || row["remote-address"] || row["ip-address"]),
    uptime: stringValue(row.uptime),
    "bytes-in": numberValue(row["bytes-in"] || row.rx || row["rx-bytes"]),
    "bytes-out": numberValue(row["bytes-out"] || row.tx || row["tx-bytes"]),
    _raw: row,
  };
}

function mapHotspotActiveRow(row = {}) {
  return {
    username: stringValue(row.user || row.name || row["mac-address"]),
    address: stringValue(row.address || row["ip-address"]),
    uptime: stringValue(row.uptime),
    "bytes-in": numberValue(row["bytes-in"]),
    "bytes-out": numberValue(row["bytes-out"]),
    _raw: row,
  };
}

async function rosPrint(tenantId, path, words = [], timeoutMs = 10_000, options = {}) {
  if (!tenantId) throw new Error("missing tenantId");

  const heavy = Boolean(options.heavy);
  const cacheKey = options.cacheKey || (heavy ? `heavy:${tenantId}:${path}:${words.join(",")}` : null);

  if (cacheKey) {
    const cacheHit = getCache(cacheKey, options.allowStaleMs || 30_000);
    if (cacheHit && cacheHit.fresh) {
      return Array.isArray(cacheHit.value) ? cacheHit.value : [];
    }
  }

  if (heavy) {
    try {
      await acquireTenantSlot(tenantId, options.acquireTimeoutMs || 3_000);
    } catch (error) {
      const stale = cacheKey ? getCache(cacheKey, options.allowStaleMs || 30_000) : null;
      if (stale) {
        console.warn(`[MikroTik] tenant busy, returning stale for ${path}`);
        return Array.isArray(stale.value) ? stale.value : [];
      }

      console.warn(`[MikroTik] tenant busy and no cache for ${path}`);
      return [];
    }
  }

  try {
    const output = await sendCommand(path, words, {
      tenantId,
      timeoutMs,
      serverId: options.serverId || null,
    });
    const rows = Array.isArray(output) ? output : output ? [output] : [];

    if (cacheKey && Array.isArray(rows)) {
      setCache(cacheKey, rows, options.cacheTtlMs || 8_000);
    }

    return rows;
  } catch (error) {
    const message = String(error?.message || error || "");

    if (/QUEUE_FULL|queue full|Router busy|Connect timeout|timed out|malformed_reply/i.test(message)) {
      console.warn(`[MikroTik] transient (${message}) for ${path} - returning cached/stale if available`);
      if (cacheKey) {
        const stale = getCache(cacheKey, options.allowStaleMs || 30_000);
        if (stale) {
          return Array.isArray(stale.value) ? stale.value : [];
        }
      }
      return [];
    }

    if (AUTH_ERR_RE.test(message)) {
      console.error(`[MikroTik] auth error for ${path}: ${message}`);
      throw error;
    }

    console.warn(`[MikroTik] print failed ${path}: ${message}`);
    return [];
  } finally {
    if (heavy) releaseTenantSlot(tenantId);
  }
}

module.exports = {
  delay,
  firstIpFromTarget,
  isPrivateIPv4,
  mapHotspotActiveRow,
  mapPPPActiveRow,
  pickServerId,
  qs,
  rosPrint,
  stringValue,
  w,
};
