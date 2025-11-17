// utils/mikrotikConnectionManager.js
// Multi-tenant, pooled MikroTik connection manager (improved)
// Requires: npm i routeros-client

const { RouterOSAPI } = require("routeros-client");
const dns = require("dns").promises;
const crypto = require("node:crypto");

// --------- Configurable knobs (tweak to taste) ---------
// timeouts raised to tolerate slower RouterOS replies (7.18+ behaviour)
const DEFAULT_TIMEOUT_MS = 120_000;   // command timeout (was 12s)
const CONNECT_TIMEOUT_MS = 120_000;   // connect handshake timeout (was 15s)
const HEALTH_INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;
const BASE_BACKOFF_MS = 2_000;
const CIRCUIT_OPEN_MS = 20_000;
const MAX_CONSECUTIVE_FAILS = 3;
// fewer retries — if we still fail after retry, investigate
const SEND_RETRY_COUNT = 2;          // lowered to 2
const SEND_RETRY_DELAY_MS = 600;
// per-entry command spacing to avoid bursts (ms)
const PER_COMMAND_GAP_MS = 300;      // slightly larger gap

// redact keys for logs
const SECRET_KEYS = ["password", "pass", "secret", "key", "token"];

// --------- Internal state & hooks ---------
const pool = new Map();

let loadTenantRouterConfig = async (_tenantId, _selector) => {
  throw new Error("loadTenantRouterConfig not set");
};
let auditLog = async (_entry) => {}; // no-op by default

function setConfigLoader(fn) { loadTenantRouterConfig = fn; }
function setAuditLogger(fn) { auditLog = fn || (() => {}); }

// --------- Helpers ---------
function k(tenantId, host, port) { return `${tenantId}:${host}:${port || 8728}`; }
function redact(str) {
  let s = String(str ?? "");
  for (const k of SECRET_KEYS) {
    const unquoted = new RegExp(`(${k}\\s*=\\s*)[^\\s"]+`, "ig");
    const quoted = new RegExp(`(${k}\\s*=\\s*")[^"]*(")`, "ig");
    s = s.replace(unquoted, "$1******").replace(quoted, "$1******$2");
  }
  return s;
}
function delay(ms){ return new Promise(r=>setTimeout(r, ms)); }
function withTimeout(promise, ms, msg = "Timeout") {
  let to;
  const t = new Promise((_, rej) => (to = setTimeout(()=> rej(new Error(msg)), ms)));
  return Promise.race([promise.finally(()=> clearTimeout(to)), t]);
}

// Normalize RouterOS result to a consistent JS type.
// Accepts arrays, strings, buffers, or library-specific objects.
// If RouterOS returns '!empty' or other "no-data" tokens, return [].
function normalizeResult(res){
  if (res == null) return [];
  // routeros-client may return string tokens like '!empty'
  if (typeof res === 'string') {
    const t = res.trim();
    if (!t) return [];
    if (t.startsWith('!empty') || /^(?:!empty|UNKNOWNREPLY|RosException)/i.test(t)) return [];
    // otherwise return the raw string (caller can interpret)
    return res;
  }
  // if it's a Buffer, convert to string and apply same rules
  if (Buffer.isBuffer(res)) {
    const s = res.toString('utf8').trim();
    if (!s) return [];
    if (s.startsWith('!empty') || /^(?:!empty|UNKNOWNREPLY|RosException)/i.test(s)) return [];
    return s;
  }
  // if it's an array-like or object, return as-is
  if (Array.isArray(res)) return res;
  if (typeof res === 'object') return res;
  // fallback: coerce to string
  try {
    const s = String(res).trim();
    if (!s) return [];
    if (s.startsWith('!empty') || /^(?:!empty|UNKNOWNREPLY|RosException)/i.test(s)) return [];
    return res;
  } catch (e) {
    return [];
  }
}

// --------- DNS cache per-entry ---------
async function resolveHostIfNeeded(entry) {
  // if host is an IP, return it
  const host = entry.cfg.host;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  const now = Date.now();
  if (entry._dns && entry._dns.ip && entry._dns.expiresAt > now) return entry._dns.ip;
  try {
    const r = await dns.lookup(host);
    const ttl = entry._dns?.ttlMs || 60_000;
    entry._dns = { ip: r.address, expiresAt: now + ttl, ttlMs: ttl };
    return r.address;
  } catch (err) {
    // don't block: return original host as fallback
    console.warn(`DNS lookup failed for ${host}: ${err.message}`);
    return host;
  }
}

// --------- Pool entry creation & per-entry queue ---------
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
      // queue + control
      cmdQueue: [],
      queueRunning: false,
      // dns cache container
      _dns: null,
      // schedules map for poll jobs
      schedules: new Map(),
    });
  }
  return pool.get(key);
}

// --------- Connect with backoff/circuit breaker (uses resolved IP) ---------
async function ensureConnected(entry) {
  const now = Date.now();
  if (entry.connected && entry.client) return entry.client;

  if (entry.circuitUntil > now) {
    throw new Error(`Circuit open until ${new Date(entry.circuitUntil).toISOString()}`);
  }

  if (entry.connecting) {
    await waitForConnect(entry);
    if (entry.connected && entry.client) return entry.client;
  }

  entry.connecting = true;
  try {
    // resolve host first (cache-friendly)
    const resolvedHost = await resolveHostIfNeeded(entry);

    const client = new RouterOSAPI({
      host: resolvedHost,
      user: entry.cfg.user,
      password: entry.cfg.password,
      port: entry.cfg.port,
      timeout: entry.cfg.timeout,
      tls: entry.cfg.tls,
    });

    await withTimeout(client.connect(), entry.cfg.timeout, "Connect timeout");
    entry.client = client;

    // attach listeners carefully (avoid duplicate handlers)
    try {
      if (typeof client.on === 'function') {
        const onError = (err) => {
          try {
            entry.lastErr = err;
            entry.connected = false;
            entry.fails += 1;
            entry.backoff = Math.min((entry.backoff || BASE_BACKOFF_MS) * 2, MAX_BACKOFF_MS);
            try { client.close().catch(()=>{}); } catch(e){}
            console.warn(`MikroTik client error ${entry.cfg.host}: ${String(err?.message || err)}`);
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
        // remove previous if present
        if (client.__mbm_on_error) try { client.removeListener('error', client.__mbm_on_error); } catch(e){}
        if (client.__mbm_on_close) try { client.removeListener('close', client.__mbm_on_close); } catch(e){}
        client.__mbm_on_error = onError;
        client.__mbm_on_close = onClose;
        client.on('error', onError);
        client.on('close', onClose);
      }
    } catch (e) { /* ignore */ }

    entry.connected = true;
    entry.fails = 0;
    entry.backoff = BASE_BACKOFF_MS;
    entry.lastErr = null;

    // small health write to confirm API healthy
    await withTimeout(client.write("/system/identity/print"), DEFAULT_TIMEOUT_MS, "Health check timeout");
    entry.lastOkAt = Date.now();

    return client;
  } catch (err) {
    entry.connected = false;
    entry.client = null;
    entry.lastErr = err;
    entry.fails += 1;
    entry.backoff = Math.min((entry.backoff || BASE_BACKOFF_MS) * 2, MAX_BACKOFF_MS);
    if (entry.fails >= MAX_CONSECUTIVE_FAILS) {
      entry.circuitUntil = Date.now() + CIRCUIT_OPEN_MS;
    }
    throw new Error(`MikroTikConnectionError: ${err.message}`);
  } finally {
    entry.connecting = false;
  }
}

function waitForConnect(entry) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (!entry.connecting) return resolve();
      if (Date.now() - t0 > CONNECT_TIMEOUT_MS + 1000) return resolve();
      setTimeout(tick, 50);
    };
    tick();
  });
}

// --------- Per-entry command queue processor (serialize + spacing) ---------
async function _processEntryQueue(entry) {
  if (entry.queueRunning) return;
  entry.queueRunning = true;
  while (entry.cmdQueue.length > 0) {
    const item = entry.cmdQueue.shift();
    const { cmd, args, options, resolve, reject } = item;
    try {
      // apply backoff if needed
      if (!entry.connected && entry.fails > 0) await delay(entry.backoff);
      const res = await _sendDirect(entry, cmd, args, options);
      resolve(res);
    } catch (err) {
      reject(err);
    }
    // small gap to avoid bursts
    await delay(PER_COMMAND_GAP_MS);
  }
  entry.queueRunning = false;
}

// Internal direct send with retries + malformed reply handling
async function _sendDirect(entry, cmd, args = [], options = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= SEND_RETRY_COUNT; attempt++) {
    try {
      const client = await ensureConnected(entry);
      const timeoutMs = Math.max(500, Math.min(options.timeoutMs || DEFAULT_TIMEOUT_MS, 70_000));
      const startedAt = Date.now();

      // routeros-client: client.write(cmd, args)
      const raw = await withTimeout(client.write(String(cmd), Array.isArray(args) ? args : []), timeoutMs, "Command timeout");

      // normalize result (handles '!empty', Buffer, arrays, etc.)
      const result = normalizeResult(raw);

      // If normalizeResult returned an empty array because the router returned '!empty' or similar,
      // treat this as a successful empty response (do not throw).
      // success bookkeeping
      entry.lastOkAt = Date.now();
      entry.fails = 0;
      entry.backoff = BASE_BACKOFF_MS;

      // audit (non-blocking)
      Promise.resolve(auditLog({
        kind: "mikrotik.exec",
        tenantId: entry.tenantId,
        host: entry.cfg.host,
        port: entry.cfg.port,
        ok: true,
        ms: Date.now() - startedAt,
        command: String(cmd),
        wordsCount: Array.isArray(args) ? args.length : 0,
        at: new Date().toISOString()
      })).catch(()=>{});

      console.log(`🛰️ MT ok ${entry.cfg.host} ${cmd} (${Date.now() - startedAt}ms)`);
      return result;
    } catch (err) {
      lastErr = err;
      const errorMsg = String(err?.message || err);
      // auth errors -> stop and open bigger circuit
      if (/username|password|authentication|login failure|invalid user/i.test(errorMsg)) {
        entry.lastErr = err;
        entry.connected = false;
        entry.fails += 1;
        entry.backoff = Math.min(entry.backoff * 2, MAX_BACKOFF_MS);
        entry.circuitUntil = Date.now() + (CIRCUIT_OPEN_MS * 6);
        console.error(`❌ MT auth err ${entry.cfg.host} ${cmd}: ${errorMsg}`);
        await Promise.resolve(auditLog({ kind: 'mikrotik.exec', tenantId: entry.tenantId, host: entry.cfg.host, command: cmd, ok: false, error: errorMsg, at: new Date().toISOString() })).catch(()=>{});
        throw err;
      }

      // transient handling: reset client and possibly retry
      try {
        entry.lastErr = err;
        entry.connected = false;
        if (entry.client && typeof entry.client.close === 'function') {
          try { entry.client.close().catch(()=>{}); } catch(e){}
        }
        entry.client = null;
        entry.fails += 1;
        entry.backoff = Math.min(entry.backoff * 2, MAX_BACKOFF_MS);
      } catch (e) {}

      const ms = errorMsg.includes('Timeout') ? 'timeout' : 'err';
      console.error(`❌ MT err ${entry.cfg.host} ${cmd} (${ms}): ${errorMsg}`);
      await Promise.resolve(auditLog({ kind: 'mikrotik.exec', tenantId: entry.tenantId, host: entry.cfg.host, command: cmd, ok: false, error: errorMsg, at: new Date().toISOString() })).catch(()=>{});

      if (attempt < SEND_RETRY_COUNT) {
        await delay(SEND_RETRY_DELAY_MS * attempt);
        continue;
      }
      // out of retries
      throw err;
    }
  }
  throw lastErr || new Error('send failed');
}

// --------- Public: sendCommand (queues per-entry) ---------
async function sendCommand(path, words = [], options = {}) {
  const tenantId = options.tenantId || options.ispId;
  if (!tenantId) throw new Error("Missing tenantId for RouterOS command");

  const selector = {
    id: options.serverId || options.server || null,
    name: options.serverName || null,
    host: options.host || null,
    port: options.port || null,
  };

  const entry = await getClientEntry(tenantId, selector);

  // command normalized
  const cmd = String(path || "").trim();
  const args = Array.isArray(words) ? words : [];

  // if circuit is open, fail fast
  if (entry.circuitUntil > Date.now()) {
    const e = new Error(`Circuit open until ${new Date(entry.circuitUntil).toISOString()}`);
    await Promise.resolve(auditLog({ kind: 'mikrotik.exec', tenantId, host: entry.cfg.host, command: cmd, ok: false, error: String(e.message), at: new Date().toISOString() })).catch(()=>{});
    throw e;
  }

  // enqueue and return a promise that resolves when processed
  return new Promise((resolve, reject) => {
    entry.cmdQueue.push({ cmd, args, options, resolve, reject });
    // kick processor
    _processEntryQueue(entry).catch(err => {
      // global fallback logging
      console.error('Queue processor error', err);
    });
  });
}

// --------- Health tick (per pooled client) ---------
async function healthTick() {
  const now = Date.now();
  await Promise.all(Array.from(pool.values()).map(async (entry) => {
    if (entry.circuitUntil > now) return;
    try {
      if (!entry.connected || !entry.client) return;
      const ms0 = Date.now();
      try {
        const raw = await withTimeout(entry.client.write("/system/identity/print"), DEFAULT_TIMEOUT_MS, "Health timeout");
        const result = normalizeResult(raw);
        // treat empty as ok for health check (router answered)
        entry.lastOkAt = Date.now();
        entry.fails = 0;
        entry.backoff = BASE_BACKOFF_MS;
        const dur = Date.now() - ms0;
        if (dur > 500) console.log(`💓 MT health ${entry.cfg.host} ${dur}ms`);
      } catch (err) {
        throw err;
      }
    } catch (err) {
      entry.connected = false;
      entry.lastErr = err;
      entry.fails += 1;
      entry.backoff = Math.min(entry.backoff * 2, MAX_BACKOFF_MS);
      if (entry.fails >= MAX_CONSECUTIVE_FAILS) entry.circuitUntil = Date.now() + CIRCUIT_OPEN_MS;
      console.warn(`⚠️ MT lost ${entry.cfg.host}: ${String(err?.message || err)}`);
    }
  }));
}
setInterval(healthTick, HEALTH_INTERVAL_MS).unref();

// --------- Schedules (safe periodic polls) ---------
function schedulePoll(tenantId, selector, name, path, words = [], intervalMs = 5000, staggerMs = 0) {
  // creates/starts a schedule job on the entry
  return (async () => {
    const entry = await getClientEntry(tenantId, selector);
    if (entry.schedules.has(name)) throw new Error(`Schedule ${name} exists`);
    let stopped = false;
    const run = async () => {
      if (stopped) return;
      try {
        await sendCommand(path, words, { tenantId, ...selector });
      } catch (err) {
        // swallow; audits already recorded in sendCommand
      } finally {
        if (!stopped) entry.schedules.set(name, setTimeout(run, intervalMs));
      }
    };
    const handle = setTimeout(run, staggerMs);
    entry.schedules.set(name, handle);
    return {
      stop: () => {
        stopped = true;
        const h = entry.schedules.get(name);
        if (h) clearTimeout(h);
        entry.schedules.delete(name);
      }
    };
  })();
}

// --------- Status snapshot for dashboards ---------
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
      queueLength: entry.cmdQueue.length,
      schedules: Array.from(entry.schedules.keys()),
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
    // clear schedules
    for (const h of entry.schedules.values()) try { clearTimeout(h); } catch(e){}
    entry.connected = false;
    entry.client = null;
  }
  await Promise.allSettled(closers);
}

process.on("SIGINT", () => shutdown().finally(()=> process.exit(0)));
process.on("SIGTERM", () => shutdown().finally(()=> process.exit(0)));

// Global safety handlers (same approach as before)
const recentExceptions = [];
const EXCEPTION_WINDOW_MS = 60_000;
const EXCEPTION_THRESHOLD = 20;
function recordAndMaybeEscalate(err) {
  try {
    recentExceptions.push(Date.now());
    const cutoff = Date.now() - EXCEPTION_WINDOW_MS;
    while (recentExceptions.length && recentExceptions[0] < cutoff) recentExceptions.shift();
    if (recentExceptions.length > EXCEPTION_THRESHOLD) {
      console.error('Too many uncaught exceptions; escalating to process exit');
      shutdown().catch(()=>{}).finally(()=> process.exit(1));
    }
  } catch (e) {}
}

process.on('uncaughtException', (err) => {
  try {
    const msg = String(err && (err.message || err) || '');
    console.error('[uncaughtException] ', msg);
    if (msg.includes('RosException') || msg.includes('UNKNOWNREPLY') || msg.includes('malformed_reply') || msg.includes('!empty')) {
      for (const entry of pool.values()) {
        try {
          entry.connected = false;
          entry.lastErr = err;
          if (entry.client && typeof entry.client.close === 'function') {
            try {
              if (entry.client.__mbm_on_error) entry.client.removeListener('error', entry.client.__mbm_on_error);
              if (entry.client.__mbm_on_close) entry.client.removeListener('close', entry.client.__mbm_on_close);
            } catch (e){}
            entry.client.close().catch(()=>{});
          }
          entry.client = null;
        } catch (e){}
      }
      Promise.resolve(auditLog({ kind: 'uncaught', error: String(msg), at: new Date().toISOString() })).catch(()=>{});
      recordAndMaybeEscalate(err);
      return;
    }
  } catch (e) {}
  recordAndMaybeEscalate(err);
});

process.on('unhandledRejection', (reason) => {
  try {
    const msg = String(reason && (reason.message || reason) || '');
    console.error('[unhandledRejection] ', msg);
    if (msg.includes('RosException') || msg.includes('UNKNOWNREPLY') || msg.includes('malformed_reply') || msg.includes('!empty')) {
      for (const entry of pool.values()) {
        try {
          entry.connected = false;
          entry.lastErr = reason;
          if (entry.client && typeof entry.client.close === 'function') {
            try {
              if (entry.client.__mbm_on_error) entry.client.removeListener('error', entry.client.__mbm_on_error);
              if (entry.client.__mbm_on_close) entry.client.removeListener('close', entry.client.__mbm_on_close);
            } catch (e){}
            entry.client.close().catch(()=>{});
          }
          entry.client = null;
        } catch (e){}
      }
      Promise.resolve(auditLog({ kind: 'unhandledRejection', error: String(msg), at: new Date().toISOString() })).catch(()=>{});
      recordAndMaybeEscalate(reason);
      return;
    }
  } catch (e){}
  recordAndMaybeEscalate(reason);
});

module.exports = {
  sendCommand,
  getStatus,
  shutdown,
  setConfigLoader,
  setAuditLogger,
  schedulePoll,
};
