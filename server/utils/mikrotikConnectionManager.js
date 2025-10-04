// utils/mikrotikConnectionManager.js
// Multi-tenant, pooled MikroTik connection manager
// Requires: npm i routeros-client

const { RouterOSAPI } = require("routeros-client");
const crypto = require("node:crypto");

// --------- Configurable knobs ---------
const DEFAULT_TIMEOUT_MS = 12_000;
const CONNECT_TIMEOUT_MS = 15_000;
const HEALTH_INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;
const BASE_BACKOFF_MS = 2_000;
const CIRCUIT_OPEN_MS = 20_000; // after repeated failures, pause connects briefly
const MAX_CONSECUTIVE_FAILS = 3;

// redact these keys in logs
const SECRET_KEYS = ["password", "pass", "secret", "key", "token"];

// --------- Internal state ---------
/**
 * pool key = `${tenantId}:${host}:${port}`
 * client entry = {
 *   key, tenantId, cfg, client, connected, connecting, lastErr,
 *   fails, backoff, circuitUntil, lastOkAt
 * }
 */
const pool = new Map();

// Hook functions you can wire from the app:
let loadTenantRouterConfig = async (_tenantId, _selector) => {
  throw new Error("loadTenantRouterConfig not set");
};
let auditLog = async (_entry) => {}; // no-op by default

// --------- Public API to set hooks ---------
function setConfigLoader(fn) {
  loadTenantRouterConfig = fn;
}
function setAuditLogger(fn) {
  auditLog = fn || (() => {});
}

// --------- Helpers ---------
function k(tenantId, host, port) {
  return `${tenantId}:${host}:${port || 8728}`;
}

function redact(str) {
  let s = String(str ?? "");
  for (const k of SECRET_KEYS) {
    const unquoted = new RegExp(`(${k}\\s*=\\s*)[^\\s"]+`, "ig");
    const quoted = new RegExp(`(${k}\\s*=\\s*")[^"]*(")`, "ig");
    s = s.replace(unquoted, "$1******").replace(quoted, "$1******$2");
  }
  return s;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout(promise, ms, msg = "Timeout") {
  let to;
  const t = new Promise((_, rej) => (to = setTimeout(() => rej(new Error(msg)), ms)));
  return Promise.race([promise.finally(() => clearTimeout(to)), t]);
}

// Normalize RouterOS response into a predictable shape
function normalizeResult(res) {
  // routeros-client returns array of rows for print, and objects for !done etc.
  return res;
}

// --------- Core: get or create pooled client ---------
async function getClientEntry(tenantId, selector) {
  const cfg = await loadTenantRouterConfig(tenantId, selector);
  if (!cfg) throw new Error("Router config not found for tenant");

  const key = k(tenantId, cfg.host, cfg.port || 8728);
  if (!pool.has(key)) {
    pool.set(key, {
      key,
      tenantId,
      cfg: {
        host: cfg.host,
        user: cfg.user,
        password: cfg.password,
        port: cfg.port || 8728,
        tls: !!cfg.tls,
        timeout: cfg.timeout || CONNECT_TIMEOUT_MS,
      },
      client: null,
      connected: false,
      connecting: false,
      lastErr: null,
      fails: 0,
      backoff: BASE_BACKOFF_MS,
      circuitUntil: 0,
      lastOkAt: 0,
    });
  }
  return pool.get(key);
}

// --------- Connect with backoff/circuit breaker ---------
async function ensureConnected(entry) {
  const now = Date.now();
  if (entry.connected && entry.client) return entry.client;

  if (entry.circuitUntil > now) {
    throw new Error(`Circuit open until ${new Date(entry.circuitUntil).toISOString()}`);
  }

  if (entry.connecting) {
    // Wait until current attempt finishes
    await waitForConnect(entry);
    if (entry.connected && entry.client) return entry.client;
    // fallthrough to retry
  }

  entry.connecting = true;
  try {
    const client = new RouterOSAPI({
      host: entry.cfg.host,
      user: entry.cfg.user,
      password: entry.cfg.password,
      port: entry.cfg.port,
      timeout: entry.cfg.timeout,
      tls: entry.cfg.tls,
    });

    await withTimeout(client.connect(), entry.cfg.timeout, "Connect timeout");
    entry.client = client;
    entry.connected = true;
    entry.fails = 0;
    entry.backoff = BASE_BACKOFF_MS;
    entry.lastErr = null;
    // small ping
    await withTimeout(client.write("/system/identity/print"), DEFAULT_TIMEOUT_MS, "Health check timeout");
    entry.lastOkAt = Date.now();

    return client;
  } catch (err) {
    entry.connected = false;
    entry.client = null;
    entry.lastErr = err;
    entry.fails += 1;
    entry.backoff = Math.min(entry.backoff * 2, MAX_BACKOFF_MS);
    if (entry.fails >= MAX_CONSECUTIVE_FAILS) {
      entry.circuitUntil = Date.now() + CIRCUIT_OPEN_MS;
    }
    throw new Error(`MikroTikConnectionError: ${err.message}`);
  } finally {
    entry.connecting = false;
  }
}

function waitForConnect(entry) {
  // Polling wait: simple and dependency-free
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (!entry.connecting) return resolve();
      if (Date.now() - t0 > CONNECT_TIMEOUT_MS + 1000) return resolve(); // give up waiting
      setTimeout(tick, 50);
    };
    tick();
  });
}

// --------- Public: sendCommand(path, words, {tenantId, timeoutMs}) ---------
async function sendCommand(path, words = [], options = {}) {
  const tenantId = options.tenantId || options.ispId; // support either naming
  if (!tenantId) throw new Error("Missing tenantId for RouterOS command");

  const selector = {
    id: options.serverId || options.server || null,
    name: options.serverName || null,
    host: options.host || null,
    port: options.port || null,
  };

  const entry = await getClientEntry(tenantId, selector);

  // Exponential backoff window if previously failing
  if (!entry.connected && entry.fails > 0) {
    await delay(entry.backoff);
  }

  const cmdId = crypto.randomUUID();
  const cmd = String(path || "").trim();
  const args = Array.isArray(words) ? words : [];

  const startedAt = Date.now();
  let ok = false;
  let errorMsg = null;
  let result = null;

  try {
    const client = await ensureConnected(entry);
    const timeoutMs = Math.max(500, Math.min(options.timeoutMs || DEFAULT_TIMEOUT_MS, 60_000));

    // routeros-client: client.write(command, paramsArray)
    result = await withTimeout(client.write(cmd, args), timeoutMs, "Command timeout");
    ok = true;
    entry.lastOkAt = Date.now();
    entry.fails = 0;
    entry.backoff = BASE_BACKOFF_MS;

    return normalizeResult(result);
  } catch (err) {
    ok = false;
    errorMsg = err?.message || String(err);
    entry.lastErr = err;
    entry.connected = false; // ensure next call reconnects
    entry.fails += 1;
    entry.backoff = Math.min(entry.backoff * 2, MAX_BACKOFF_MS);
    throw new Error(errorMsg);
  } finally {
    const ms = Date.now() - startedAt;
    // Structured audit (non-blocking)
    Promise.resolve(
      auditLog({
        kind: "mikrotik.exec",
        tenantId,
        host: entry.cfg.host,
        port: entry.cfg.port,
        ok,
        ms,
        command: cmd,
        wordsCount: args.length,
        error: errorMsg ? String(errorMsg) : undefined,
        at: new Date().toISOString(),
      })
    ).catch(() => {});

    // Console log (redacted)
    const logLine = ok
      ? `🛰️ MT ok ${entry.cfg.host} ${cmd} (${ms}ms)`
      : `❌ MT err ${entry.cfg.host} ${redact(cmd)} (${ms}ms): ${errorMsg}`;
    console.log(logLine);
  }
}

// --------- Health watchdog (per pooled client) ---------
async function healthTick() {
  const now = Date.now();
  await Promise.all(
    Array.from(pool.values()).map(async (entry) => {
      // Skip if circuit is open; skip if no client yet
      if (entry.circuitUntil > now) return;

      try {
        if (!entry.connected) return; // will reconnect on demand
        const ms0 = Date.now();
        const res = await withTimeout(entry.client.write("/system/identity/print"), DEFAULT_TIMEOUT_MS, "Health timeout");
        entry.lastOkAt = Date.now();
        entry.fails = 0;
        entry.backoff = BASE_BACKOFF_MS;
        // brief noisy print only if gets slow
        const dur = Date.now() - ms0;
        if (dur > 500) console.log(`💓 MT health ${entry.cfg.host} ${dur}ms`);
      } catch (err) {
        entry.connected = false;
        entry.lastErr = err;
        entry.fails += 1;
        entry.backoff = Math.min(entry.backoff * 2, MAX_BACKOFF_MS);
        if (entry.fails >= MAX_CONSECUTIVE_FAILS) entry.circuitUntil = Date.now() + CIRCUIT_OPEN_MS;
        console.warn(`⚠️ MT lost ${entry.cfg.host}: ${err.message}`);
      }
    })
  );
}
setInterval(healthTick, HEALTH_INTERVAL_MS).unref();

// --------- Public: status snapshot for dashboards ---------
function getStatus() {
  const arr = [];
  for (const entry of pool.values()) {
    arr.push({
      key: entry.key,
      tenantId: entry.tenantId,
      host: entry.cfg.host,
      port: entry.cfg.port,
      connected: entry.connected,
      lastOkAt: entry.lastOkAt,
      fails: entry.fails,
      backoff: entry.backoff,
      circuitUntil: entry.circuitUntil,
      lastErr: entry.lastErr ? String(entry.lastErr.message || entry.lastErr) : null,
    });
  }
  return arr;
}

// --------- Graceful shutdown ---------
async function shutdown() {
  const closers = [];
  for (const entry of pool.values()) {
    if (entry.client) {
      try {
        closers.push(entry.client.close().catch(() => {}));
      } catch {}
    }
    entry.connected = false;
    entry.client = null;
  }
  await Promise.allSettled(closers);
}

process.on("SIGINT", () => shutdown().finally(() => process.exit(0)));
process.on("SIGTERM", () => shutdown().finally(() => process.exit(0)));

module.exports = {
  // main API
  sendCommand,          // (path, words[], { tenantId, timeoutMs })
  getStatus,
  shutdown,

  // hooks you must set from your app
  setConfigLoader,      // (tenantId) => { host,user,password,port?,tls?,timeout? }
  setAuditLogger,       // (entry) => Promise<void>
};
