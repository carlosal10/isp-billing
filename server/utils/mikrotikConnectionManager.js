// utils/mikrotikConnectionManager.js
// Multi-tenant, pooled MikroTik connection manager
// Requires: npm i routeros-client

const { RouterOSAPI } = require("routeros-client");
const crypto = require("node:crypto");

// --------- Configurable knobs ---------
// conservative defaults while investigating timeouts/UNKNOWNREPLY
const DEFAULT_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 30_000;
const HEALTH_INTERVAL_MS = 60_000;
const MAX_BACKOFF_MS = 120_000;
const BASE_BACKOFF_MS = 2_000;
const CIRCUIT_OPEN_MS = 120_000; // longer pause to avoid thrashing
const MAX_CONSECUTIVE_FAILS = 6;
const SEND_RETRY_COUNT = 5;
const SEND_RETRY_DELAY_MS = 750;

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

// --- per-entry FIFO queues (serialize requests per router) ---
const queues = new Map();
function enqueue(entry, fn) {
  const key = entry.key;
  if (!queues.has(key)) queues.set(key, Promise.resolve());
  const prev = queues.get(key);
  const next = prev
    .catch(() => {}) // swallow previous failure to keep queue moving
    .then(() => fn());
  queues.set(key, next);
  return next;
}

// --- RAW SOCKET CAPTURE (for debugging UNKNOWNREPLY / !empty) ---
function entryKeyFromEntry(entry) {
  return `${entry?.cfg?.host || 'unknown'}:${entry?.cfg?.port || 8728}`;
}
function attachRawCapture(client, entry, timeoutMs = 3000) {
  try {
    const sock = client && (client._socket || client.socket || client.sock);
    if (!sock || typeof sock.on !== 'function') return () => {};
    const key = entryKeyFromEntry(entry);
    const onData = (chunk) => {
      try {
        const hex = chunk && Buffer.isBuffer(chunk) ? chunk.toString('hex') : String(chunk).slice(0, 200);
        const ascii = chunk && Buffer.isBuffer(chunk) ? chunk.toString('utf8').replace(/[^\x20-\x7E]+/g, '.') : '';
        console.warn(`[raw-socket ${key}] hex(${hex.length}): ${hex.slice(0, 800)} ascii-preview: ${ascii.slice(0,200)}`);
      } catch (e) {}
    };
    sock.on('data', onData);
    const off = () => {
      try { sock.removeListener('data', onData); } catch (e) {}
    };
    setTimeout(off, timeoutMs).unref();
    return off;
  } catch (e) {
    return () => {};
  }
}

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
  // attach a short-lived raw capture to help debug parser failures like UNKNOWNREPLY / !empty
  try { entry.__rawOff?.(); if (process.env.MBM_RAW_CAPTURE === '1') entry.__rawOff = attachRawCapture(client, entry, 2500); } catch (e) {}
    // Attach defensive event handlers to catch library-level errors and
    // ensure the pool entry reflects a disconnected state so subsequent
    // calls will attempt reconnect.
    try {
      if (typeof client.on === 'function') {
        const onError = (err) => {
          try {
            entry.lastErr = err;
            entry.connected = false;
            entry.fails += 1;
            entry.backoff = Math.min(entry.backoff * 2 || BASE_BACKOFF_MS, MAX_BACKOFF_MS);
            // Attempt to close the client gracefully
            if (typeof client.close === 'function') client.close().catch(() => {});
            console.warn(`MikroTik client error for ${entry.cfg.host}: ${String(err?.message || err)}`);
          } catch (e) {}
        };
        const onClose = () => {
          try {
            entry.connected = false;
            entry.client = null;
            entry.lastErr = new Error('client-closed');
            console.warn(`MikroTik client closed for ${entry.cfg.host}`);
          } catch (e) {}
        };
        client.__mbm_on_error = onError;
        client.__mbm_on_close = onClose;
        client.on('error', onError);
        client.on('close', onClose);
      }
    } catch (e) {
      // ignore attach failures
    }
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
    // ensure we clear the raw capture if connect failed
    try { if (!entry.connected) { entry.__rawOff?.(); entry.__rawOff = null; } } catch (e) {}
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

  // helper to detect auth errors from router
  const isAuthError = (msg) => {
    if (!msg) return false;
    const s = String(msg).toLowerCase();
    return s.includes('username or password') || s.includes('invalid user') || s.includes('authentication failed') || s.includes('login failure');
  };

  for (let attempt = 1; attempt <= SEND_RETRY_COUNT; attempt++) {
    try {
      const client = await ensureConnected(entry);
      const timeoutMs = Math.max(500, Math.min(options.timeoutMs || DEFAULT_TIMEOUT_MS, 60_000));

  // routeros-client: client.write(command, paramsArray)
  // Use per-entry enqueue to serialize per-host requests (reduce parser pressure)
  result = await withTimeout(enqueue(entry, () => client.write(cmd, args)), timeoutMs, "Command timeout");
      ok = true;
      entry.lastOkAt = Date.now();
      entry.fails = 0;
      entry.backoff = BASE_BACKOFF_MS;

      // Structured audit (non-blocking)
      Promise.resolve(
        auditLog({
          kind: "mikrotik.exec",
          tenantId,
          host: entry.cfg.host,
          port: entry.cfg.port,
          ok: true,
          ms: Date.now() - startedAt,
          command: cmd,
          wordsCount: args.length,
          at: new Date().toISOString(),
        })
      ).catch(() => {});

      console.log(`🛰️ MT ok ${entry.cfg.host} ${cmd} (${Date.now() - startedAt}ms)`);
      return normalizeResult(result);
    } catch (err) {
      errorMsg = err?.message || String(err);
      // If auth error, mark entry failed and do not retry
      if (isAuthError(errorMsg)) {
        entry.lastErr = err;
        entry.connected = false;
        entry.fails += 1;
        entry.backoff = Math.min(entry.backoff * 2, MAX_BACKOFF_MS);
        // open circuit longer for auth errors
        entry.circuitUntil = Date.now() + CIRCUIT_OPEN_MS * 6;
        console.error(`❌ MT err ${entry.cfg.host} ${cmd} (${Date.now() - startedAt}ms): ${errorMsg}`);
        // audit
        Promise.resolve(auditLog({ kind: 'mikrotik.exec', tenantId, host: entry.cfg.host, command: cmd, ok: false, error: String(errorMsg), at: new Date().toISOString() })).catch(() => {});
        throw new Error(errorMsg);
      }

      // classify transient errors (parser/socket/timeout)
      const transient = /UNKNOWNREPLY|UNKNOWN REPLY|!empty|Command timeout|ECONNRESET|EPIPE|ETIMEDOUT|socket hang up/i.test(errorMsg);

      if (transient) {
        try { if (entry.client) attachRawCapture(entry.client, entry, 3000); } catch (e) {}
        try { entry.connected = false; if (entry.client && typeof entry.client.close === 'function') entry.client.close().catch(()=>{}); } catch(e){}
        entry.client = null;
        entry.lastErr = err;
        entry.fails += 1;
        entry.backoff = Math.min(entry.backoff * 2, MAX_BACKOFF_MS);
        console.error(`❌ MT transient ${entry.cfg.host} ${cmd} (${Date.now() - startedAt}ms): ${errorMsg} — will retry`);
        Promise.resolve(auditLog({ kind:'mikrotik.exec', tenantId, host: entry.cfg.host, command: cmd, ok:false, error:String(errorMsg), transient:true, at:new Date().toISOString() })).catch(()=>{});
        if (attempt < SEND_RETRY_COUNT) {
          await delay(SEND_RETRY_DELAY_MS * attempt);
          continue;
        }
        if (entry.fails >= MAX_CONSECUTIVE_FAILS) entry.circuitUntil = Date.now() + CIRCUIT_OPEN_MS;
        throw new Error(errorMsg);
      }

      // fallback: non-transient and non-auth => treat as failure as before
      try { entry.lastErr = err; entry.connected = false; if (entry.client && typeof entry.client.close === 'function') entry.client.close().catch(() => {}); } catch(e){}
      entry.client = null;
      entry.fails += 1;
      entry.backoff = Math.min(entry.backoff * 2, MAX_BACKOFF_MS);
      const ms = Date.now() - startedAt;
      console.error(`❌ MT err ${entry.cfg.host} ${cmd} (${ms}ms): ${errorMsg}`);
      Promise.resolve(auditLog({ kind: 'mikrotik.exec', tenantId, host: entry.cfg.host, command: cmd, ok: false, error: String(errorMsg), at: new Date().toISOString() })).catch(() => {});
      if (attempt < SEND_RETRY_COUNT) { await delay(SEND_RETRY_DELAY_MS * attempt); continue; }
      if (entry.fails >= MAX_CONSECUTIVE_FAILS) entry.circuitUntil = Date.now() + CIRCUIT_OPEN_MS;
      throw new Error(errorMsg);
    }
  }
  // should not reach here
  throw new Error(errorMsg || 'sendCommand failed');
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
        try {
          if (typeof entry.client.removeListener === 'function') {
            if (entry.client.__mbm_on_error) entry.client.removeListener('error', entry.client.__mbm_on_error);
            if (entry.client.__mbm_on_close) entry.client.removeListener('close', entry.client.__mbm_on_close);
          }
        } catch (e) {}
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

// Global safety handlers: capture uncaught exceptions and unhandled rejections
// coming from the underlying routeros-client library (e.g., RosException
// UNKNOWNREPLY). We try to recover by closing affected clients and marking
// entries disconnected. If the application experiences a flood of such
// exceptions we exit to allow the platform (Render/Kubernetes) to restart
// the instance.
const recentExceptions = [];
const EXCEPTION_WINDOW_MS = 60_000; // 1 minute
const EXCEPTION_THRESHOLD = 20; // after this many events in the window we exit

function recordAndMaybeEscalate(err) {
  try {
    recentExceptions.push(Date.now());
    // drop old
    const cutoff = Date.now() - EXCEPTION_WINDOW_MS;
    while (recentExceptions.length && recentExceptions[0] < cutoff) recentExceptions.shift();
    if (recentExceptions.length > EXCEPTION_THRESHOLD) {
      console.error('Too many uncaught exceptions; escalating to process exit');
      // try best-effort shutdown then exit
      shutdown()
        .catch(() => {})
        .finally(() => process.exit(1));
    }
  } catch (e) {
    // ignore
  }
}

process.on('uncaughtException', (err) => {
  try {
    const msg = String(err && (err.message || err) || '');
    console.error('[uncaughtException] ', msg);
    // If this looks like a router RosException, attempt to recover the pool
    if (msg.includes('RosException') || msg.includes('UNKNOWNREPLY') || (err && err.errno === 'UNKNOWNREPLY')) {
      // Mark all pool entries disconnected and attempt to close clients
      for (const entry of pool.values()) {
        try {
          entry.connected = false;
          entry.lastErr = err;
          if (entry.client && typeof entry.client.close === 'function') {
            try {
              if (entry.client.__mbm_on_error) entry.client.removeListener('error', entry.client.__mbm_on_error);
              if (entry.client.__mbm_on_close) entry.client.removeListener('close', entry.client.__mbm_on_close);
            } catch (e) {}
            entry.client.close().catch(() => {});
          }
          entry.client = null;
        } catch (e) {}
      }
      // audit and continue
      Promise.resolve(auditLog({ kind: 'uncaught', error: String(msg), at: new Date().toISOString() })).catch(() => {});
      recordAndMaybeEscalate(err);
      return; // swallow and continue
    }
  } catch (e) {
    // fallthrough to escalate below
  }
  // For other errors, escalate (let the platform restart) after logging
  console.error('[uncaughtException] escalating', err);
  recordAndMaybeEscalate(err);
});

process.on('unhandledRejection', (reason) => {
  try {
    const msg = String(reason && (reason.message || reason) || '');
    console.error('[unhandledRejection] ', msg);
    if (msg.includes('RosException') || msg.includes('UNKNOWNREPLY')) {
      // same recovery path as above
      for (const entry of pool.values()) {
        try {
          entry.connected = false;
          entry.lastErr = reason;
          if (entry.client && typeof entry.client.close === 'function') {
            try {
              if (entry.client.__mbm_on_error) entry.client.removeListener('error', entry.client.__mbm_on_error);
              if (entry.client.__mbm_on_close) entry.client.removeListener('close', entry.client.__mbm_on_close);
            } catch (e) {}
            entry.client.close().catch(() => {});
          }
          entry.client = null;
        } catch (e) {}
      }
      Promise.resolve(auditLog({ kind: 'unhandledRejection', error: String(msg), at: new Date().toISOString() })).catch(() => {});
      recordAndMaybeEscalate(reason);
      return;
    }
  } catch (e) {}
  recordAndMaybeEscalate(reason);
});

module.exports = {
  // main API
  sendCommand,          // (path, words[], { tenantId, timeoutMs })
  getStatus,
  shutdown,

  // hooks you must set from your app
  setConfigLoader,      // (tenantId) => { host,user,password,port?,tls?,timeout? }
  setAuditLogger,       // (entry) => Promise<void>
};
