// utils/mikrotikConnectionManager.js
// Multi-tenant, pooled MikroTik connection manager (patched)
// - queue cap + early reject
// - connect promise to avoid busy-wait races
// - idle eviction for pool entries
// - stronger redactObj for logging
// - bounded concurrent health probes
// - removed circuit-breaker (no circuitUntil use)
// - touch semantics, forceReconnect helper
// - minimal API surface unchanged

const { RouterOSAPI } = require("routeros-client");
const dns = require("dns").promises;

// --------- Configurable knobs (tweak to taste) ---------
const DEFAULT_TIMEOUT_MS = 120_000;   // command timeout (was 12s)
const CONNECT_TIMEOUT_MS = 120_000;   // connect handshake timeout (was 15s)
const HEALTH_INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;
const BASE_BACKOFF_MS = 2_000;
const MAX_CONSECUTIVE_FAILS = 3;
const SEND_RETRY_COUNT = 2;          // retries
const SEND_RETRY_DELAY_MS = 600;
const PER_COMMAND_GAP_MS = 300;      // per-command spacing (ms)

const SECRET_KEYS = ["password", "pass", "secret", "key", "token"];

// new knobs
const MAX_QUEUE_LENGTH = 200;
const ENTRY_IDLE_MS = 10 * 60_000; // 10 minutes idle eviction
const POOL_EVICT_INTERVAL_MS = 60_000;
const HEALTH_CONCURRENCY = 10; // bound concurrent health probes

// --------- Internal state & hooks ---------
const pool = new Map();

let loadTenantRouterConfig = async (_tenantId, _selector) => {
  throw new Error("loadTenantRouterConfig not set");
};
let auditLog = async (_entry) => {};

function setConfigLoader(fn) { loadTenantRouterConfig = fn; }
function setAuditLogger(fn) { auditLog = fn || (async()=>{}); }

// --------- Helpers ---------
function k(tenantId, host, port) { return `${tenantId}:${host}:${port || 8728}`; }

function redactObj(obj) {
  if (obj == null) return obj;
  if (typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [kk, vv] of Object.entries(obj)) {
    const keyLower = String(kk).toLowerCase();
    if (SECRET_KEYS.includes(keyLower)) {
      out[kk] = '******';
    } else if (vv && typeof vv === 'object') {
      out[kk] = redactObj(vv);
    } else if (typeof vv === 'string') {
      // also scrub tokens in URLs or querystrings
      try {
        out[kk] = vv.replace(/(token|password|pass|secret|key)=([^&\s"]+)/ig, "$1=******");
      } catch (e) { out[kk] = '******'; }
    } else {
      out[kk] = vv;
    }
  }
  return out;
}

function delay(ms){ return new Promise(r=>setTimeout(r, ms)); }

function withTimeout(promise, ms, msg = "Timeout") {
  let to;
  const t = new Promise((_, rej) => (to = setTimeout(()=> rej(new Error(msg)), ms)));
  return Promise.race([promise.finally(()=> clearTimeout(to)), t]);
}

function normalizeResult(res){
  if (res == null) return [];
  if (typeof res === 'string') {
    const t = res.trim();
    if (!t) return [];
    if (t.startsWith('!empty') || /^(?:!empty|UNKNOWNREPLY|RosException)/i.test(t)) return [];
    return res;
  }
  if (Buffer.isBuffer(res)) {
    const s = res.toString('utf8').trim();
    if (!s) return [];
    if (s.startsWith('!empty') || /^(?:!empty|UNKNOWNREPLY|RosException)/i.test(s)) return [];
    return s;
  }
  if (Array.isArray(res)) return res;
  if (typeof res === 'object') return res;
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
  const host = entry.cfg.host;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  const now = Date.now();
  if (entry._dns && entry._dns.ip && entry._dns.expiresAt > now) return entry._dns.ip;
  try {
    const r = await dns.lookup(host);
    const ttl = entry._dns?.ttlMs ?? 60_000;
    entry._dns = { ip: r.address, expiresAt: now + Math.max(30_000, ttl), ttlMs: Math.max(30_000, ttl) };
    return r.address;
  } catch (err) {
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
      _connectPromise: null,
      lastErr: null,
      fails: 0,
      backoff: BASE_BACKOFF_MS,
      lastOkAt: 0,
      cmdQueue: [],
      queueRunning: false,
      _dns: null,
      schedules: new Map(),
      _lastTouched: Date.now(),
    });
  }
  return pool.get(key);
}

function touchEntry(entry){ entry._lastTouched = Date.now(); }

// --------- Connect with backoff (uses resolved IP) using a connect promise ---------
async function ensureConnected(entry) {
  if (entry.connected && entry.client) return entry.client;

  // if a connect is already in progress, await it
  if (entry._connectPromise) {
    try {
      await entry._connectPromise;
    } catch (e) {
      // swallow; will proceed to start a new attempt below if needed
    }
    if (entry.connected && entry.client) return entry.client;
  }

  // create a new connect promise
  entry.connecting = true;
  entry._connectPromise = (async () => {
    try {
      const resolvedHost = await resolveHostIfNeeded(entry);

      const client = new RouterOSAPI({
        host: resolvedHost,
        user: entry.cfg.user,
        password: entry.cfg.password,
        port: entry.cfg.port,
        timeout: CONNECT_TIMEOUT_MS,
        tls: entry.cfg.tls,
      });

      await withTimeout(client.connect(), CONNECT_TIMEOUT_MS, "Connect timeout");

      // attach listeners
      try {
        if (typeof client.on === 'function') {
          const onError = (err) => {
            try {
              entry.lastErr = err;
              entry.connected = false;
              entry.fails += 1;
              entry.backoff = Math.min((entry.backoff || BASE_BACKOFF_MS) * 2, MAX_BACKOFF_MS);
              safeCloseClient(entry);
              console.warn(`MikroTik client error ${entry.cfg.host}: ${String(err?.message || err)}`);
            } catch (e) {}
          };
          const onClose = () => {
            try {
              entry.connected = false;
              if (entry.client === client) entry.client = null;
              entry.lastErr = new Error('client-closed');
              console.warn(`MikroTik client closed for ${entry.cfg.host}`);
            } catch (e) {}
          };

          if (client.__mbm_on_error) try { client.removeListener('error', client.__mbm_on_error); } catch(e){}
          if (client.__mbm_on_close) try { client.removeListener('close', client.__mbm_on_close); } catch(e){}
          client.__mbm_on_error = onError;
          client.__mbm_on_close = onClose;
          client.on('error', onError);
          client.on('close', onClose);
        }
      } catch (e) {}

      entry.client = client;
      entry.connected = true;
      entry.fails = 0;
      entry.backoff = BASE_BACKOFF_MS;
      entry.lastErr = null;

      // Do a lightweight health check (don't fail the connect if it times out)
      try {
        await withTimeout(client.write("/system/identity/print"), Math.min(DEFAULT_TIMEOUT_MS, 10_000), "Health check timeout");
        entry.lastOkAt = Date.now();
      } catch (healthErr) {
        console.warn(`Health probe slow/failed for ${entry.cfg.host}: ${String(healthErr.message || healthErr)}`);
      }

      touchEntry(entry);
      return client;
    } catch (err) {
      // ensure client is closed and state updated
      try { entry.connected = false; } catch(e){}
      try { if (entry.client && typeof entry.client.close === 'function') entry.client.close().catch(()=>{}); } catch(e){}
      entry.client = null;

      entry.lastErr = err;
      entry.fails = (entry.fails || 0) + 1;
      entry.backoff = Math.min((entry.backoff || BASE_BACKOFF_MS) * 2, MAX_BACKOFF_MS);
      throw err;
    } finally {
      entry.connecting = false;
      // clear promise only after a small delay to prevent thundering herd
      setTimeout(() => { if (entry._connectPromise) entry._connectPromise = null; }, 50);
    }
  })();

  return entry._connectPromise;
}

// safe close helper (best-effort)
function safeCloseClient(entry) {
  try {
    const c = entry.client;
    if (!c) return;
    try {
      if (typeof c.removeListener === 'function') {
        if (c.__mbm_on_error) c.removeListener('error', c.__mbm_on_error);
        if (c.__mbm_on_close) c.removeListener('close', c.__mbm_on_close);
      }
    } catch (e) {}
    try {
      const maybe = c.close();
      if (maybe && typeof maybe.then === 'function') maybe.catch(()=>{});
    } catch (e) {}
    entry.client = null;
    entry.connected = false;
  } catch (e) {}
}

// --------- Per-entry command queue processor (serialize + spacing) ---------
async function _processEntryQueue(entry) {
  if (entry.queueRunning) return;
  entry.queueRunning = true;
  try {
    while (entry.cmdQueue.length > 0) {
      const item = entry.cmdQueue.shift();
      const { cmd, args, options, resolve, reject } = item;
      try {
        if (!entry.connected && entry.fails > 0) await delay(entry.backoff);
        const res = await _sendDirect(entry, cmd, args, options);
        resolve(res);
      } catch (err) {
        reject(err);
      }
      await delay(PER_COMMAND_GAP_MS);
    }
  } finally {
    entry.queueRunning = false;
  }
}

// Internal direct send with retries + malformed reply handling
async function _sendDirect(entry, cmd, args = [], options = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= SEND_RETRY_COUNT; attempt++) {
    try {
      const client = await ensureConnected(entry);
      const timeoutMs = Math.max(500, Math.min(options.timeoutMs || DEFAULT_TIMEOUT_MS, 70_000));
      const startedAt = Date.now();

      const raw = await withTimeout(client.write(String(cmd), Array.isArray(args) ? args : []), timeoutMs, "Command timeout");
      const result = normalizeResult(raw);

      // success bookkeeping
      entry.lastOkAt = Date.now();
      entry.fails = 0;
      entry.backoff = BASE_BACKOFF_MS;
      touchEntry(entry);

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

      // auth errors -> escalate quickly (no circuit)
      if (/username|password|authentication|login failure|invalid user/i.test(errorMsg)) {
        entry.lastErr = err;
        entry.connected = false;
        entry.fails = (entry.fails || 0) + 1;
        entry.backoff = Math.min((entry.backoff || BASE_BACKOFF_MS) * 2, MAX_BACKOFF_MS);
        console.error(`❌ MT auth err ${entry.cfg.host} ${cmd}: ${errorMsg}`);
        await Promise.resolve(auditLog({ kind: 'mikrotik.exec', tenantId: entry.tenantId, host: entry.cfg.host, command: cmd, ok: false, error: errorMsg, at: new Date().toISOString() })).catch(()=>{});
        throw err;
      }

      // transient handling: reset client and possibly retry
      try {
        entry.lastErr = err;
        entry.connected = false;
        safeCloseClient(entry);
        entry.fails = (entry.fails || 0) + 1;
        entry.backoff = Math.min((entry.backoff || BASE_BACKOFF_MS) * 2, MAX_BACKOFF_MS);
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
  const cmd = String(path || "").trim();
  const args = Array.isArray(words) ? words : [];

  // queue cap check
  if (entry.cmdQueue.length >= MAX_QUEUE_LENGTH) {
    const e = new Error('Router busy — command queue full');
    e.code = 'QUEUE_FULL';
    await Promise.resolve(auditLog({ kind:'mikrotik.exec', tenantId, host: entry.cfg.host, command: cmd, ok:false, error: e.message, at: new Date().toISOString() })).catch(()=>{});
    throw e;
  }

  touchEntry(entry);

  return new Promise((resolve, reject) => {
    entry.cmdQueue.push({ cmd, args, options, resolve, reject });
    _processEntryQueue(entry).catch(err => {
      console.error('Queue processor error', err);
    });
  });
}

// --------- Health tick (bounded concurrency) ---------
async function _limitedMap(list, concurrency, fn) {
  const out = [];
  let i = 0;
  const workers = new Array(Math.min(concurrency, list.length)).fill(0).map(async () => {
    while (i < list.length) {
      const idx = i++;
      try {
        out[idx] = await fn(list[idx], idx);
      } catch (e) {
        out[idx] = e;
      }
    }
  });
  await Promise.all(workers);
  return out;
}

async function healthTick() {
  const entries = Array.from(pool.values()).filter(e => e.connected && e.client);
  if (!entries.length) return;
  await _limitedMap(entries, HEALTH_CONCURRENCY, async (entry) => {
    try {
      const ms0 = Date.now();
      try {
        const raw = await withTimeout(entry.client.write("/system/identity/print"), Math.min(DEFAULT_TIMEOUT_MS, 8_000), "Health timeout");
        normalizeResult(raw);
        entry.lastOkAt = Date.now();
        entry.fails = 0;
        entry.backoff = BASE_BACKOFF_MS;
        const dur = Date.now() - ms0;
        if (dur > 500) console.log(`💓 MT health ${entry.cfg.host} ${dur}ms`);
        touchEntry(entry);
      } catch (err) {
        throw err;
      }
    } catch (err) {
      entry.connected = false;
      entry.lastErr = err;
      entry.fails = (entry.fails || 0) + 1;
      entry.backoff = Math.min((entry.backoff || BASE_BACKOFF_MS) * 2, MAX_BACKOFF_MS);
      console.warn(`⚠️ MT lost ${entry.cfg.host}: ${String(err?.message || err)}`);
      safeCloseClient(entry);
    }
  });
}
setInterval(healthTick, HEALTH_INTERVAL_MS).unref();

// --------- Schedules (safe periodic polls) ---------
function schedulePoll(tenantId, selector, name, path, words = [], intervalMs = 5000, staggerMs = 0) {
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
      lastErr: entry.lastErr ? String(entry.lastErr.message || entry.lastErr) : null,
      queueLength: entry.cmdQueue.length,
      schedules: Array.from(entry.schedules.keys()),
      lastTouched: entry._lastTouched || null,
    });
  }
  return arr;
}

// --------- Idle eviction ---------
setInterval(() => {
  const now = Date.now();
  for (const [k, entry] of pool.entries()) {
    if (!entry.queueRunning && entry.cmdQueue.length === 0 && entry.schedules.size === 0) {
      const lastOk = entry.lastOkAt || entry._lastTouched || 0;
      if (now - lastOk > ENTRY_IDLE_MS) {
        try {
          safeCloseClient(entry);
        } catch (e) {}
        pool.delete(k);
        console.log('Evicted idle router', entry.cfg.host);
      }
    }
  }
}, POOL_EVICT_INTERVAL_MS).unref();

// --------- Force reconnect helper for ops/tests ---------
async function forceReconnect(tenantId, selector) {
  const entry = await getClientEntry(tenantId, selector);
  entry.fails = 0;
  entry.backoff = BASE_BACKOFF_MS;
  entry.lastErr = null;
  try {
    safeCloseClient(entry);
  } catch (e) {}
  // start a new connect asynchronously
  entry._connectPromise = null;
  return ensureConnected(entry);
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
        try { closers.push(entry.client.close().catch(() => {})); } catch(e){}
      } catch {}
    }
    for (const h of entry.schedules.values()) try { clearTimeout(h); } catch(e){}
    entry.connected = false;
    entry.client = null;
  }
  await Promise.allSettled(closers);
}

process.on("SIGINT", () => shutdown().finally(()=> process.exit(0)));
process.on("SIGTERM", () => shutdown().finally(()=> process.exit(0)));

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
          safeCloseClient(entry);
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
          safeCloseClient(entry);
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
  forceReconnect,
};
