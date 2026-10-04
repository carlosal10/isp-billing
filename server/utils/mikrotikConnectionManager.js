'use strict';
const { createHash } = require('node:crypto');
const { isIP } = require('node:net');
const { CompatibleRouterOSAPI } = require('./routerOsClient');
const { connectionDiagnostic } = require('../services/routerConnectionDiagnostics');

const failure = code => Object.assign(new Error(code), { code });
const bounded = (value, fallback = 15000) => Math.min(70000, Math.max(500, Number(value) || fallback));
const isRead = path => /\/(print|getall|count-only)$/.test(path);

function createConnectionManager({ clientFactory = options => new CompatibleRouterOSAPI(options) } = {}) {
  const pool = new Map();
  let loadConfig = async () => null;
  let audit = async () => {};

  function close(entry) {
    const client = entry.client;
    entry.client = null; entry.connected = false;
    if (!client) return;
    // close() in node-routeros does nothing during a stalled handshake.
    // Destroy the socket so timed-out work cannot execute later.
    try { Promise.resolve(client.close()).catch(() => {}); } catch {}
    try { client.connector?.socket?.destroy(); } catch {}
  }

  async function getEntry(tenantId, selector) {
    const cfg = await loadConfig(tenantId, selector);
    if (!cfg) throw failure('ROUTER_NOT_FOUND');
    const normalized = { ...cfg, port: cfg.port || (cfg.tls ? 8729 : 8728) };
    const key = tenantId + ':' + (cfg.id || cfg.host + ':' + normalized.port);
    const fingerprint = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    let entry = pool.get(key);
    if (entry && entry.fingerprint !== fingerprint) {
      retire(entry); pool.delete(key); entry = null;
    }
    if (!entry) {
      entry = { key, tenantId, cfg: normalized, fingerprint, queue: [], running: false,
        client: null, connected: false, fails: 0, lastOkAt: null, lastErr: null,
        touched: Date.now(), schedules: new Map() };
      pool.set(key, entry);
    }
    return entry;
  }

  function timebox(entry, work, ms) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, result) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (entry.cancel === cancel) entry.cancel = null;
        fn(result);
      };
      const cancel = error => { close(entry); finish(reject, error); };
      const timer = setTimeout(() => cancel(failure('ROUTER_TIMEOUT')), ms);
      entry.cancel = cancel;
      Promise.resolve().then(work).then(result => finish(resolve, result), error => finish(reject, error));
    });
  }

  async function connect(entry, remaining) {
    if (entry.connected && entry.client) return entry.client;
    const cfg = entry.cfg;
    const client = clientFactory({ host: cfg.host, user: cfg.user, password: cfg.password,
      port: cfg.port, timeout: Math.max(1, Math.ceil(Math.min(remaining, cfg.timeout || 15000) / 1000)),
      // Preserve the hostname for certificate validation and SNI.
      tls: cfg.tls ? { rejectUnauthorized: true, ...(isIP(cfg.host) ? {} : { servername: cfg.host }) } : false });
    entry.client = client;
    client.on?.('error', error => {
      if (entry.client !== client) return;
      entry.lastErr = connectionDiagnostic(error).code;
      entry.cancel?.(error); close(entry);
    });
    client.on?.('close', () => {
      if (entry.client !== client) return;
      entry.cancel?.(failure('ROUTER_CLOSED')); close(entry);
    });
    await timebox(entry, () => client.connect(), Math.min(remaining, bounded(cfg.timeout)));
    if (entry.retired || entry.client !== client) throw failure('CONFIG_CHANGED');
    entry.connected = true;
    return client;
  }

  async function drain(entry) {
    if (entry.running) return;
    entry.running = true;
    try {
      while (entry.queue.length) {
        const item = entry.queue.shift();
        if (item.expired) continue;
        const started = Date.now();
        let sent = false;
        try {
          let result;
          const attempts = isRead(item.path) ? Math.min(2, Math.max(1, Number(item.options.retryCount) || 2)) : 1;
          for (let attempt = 0; attempt < attempts; attempt++) {
            try {
              const remaining = item.deadline - Date.now();
              if (remaining <= 0 || item.expired) throw failure('QUEUE_TIMEOUT');
              if (entry.retired) throw failure('CONFIG_CHANGED');
              const client = await connect(entry, remaining);
              if (item.expired || Date.now() >= item.deadline) throw failure('QUEUE_TIMEOUT');
              sent = true;
              result = await timebox(entry, () => client.write(item.path, item.words), item.deadline - Date.now());
              break;
            } catch (error) {
              close(entry);
              const reason = connectionDiagnostic(error).code;
              if (attempt + 1 >= attempts || !['unreachable', 'dns', 'refused'].includes(reason)) throw error;
            }
          }
          entry.lastOkAt = Date.now(); entry.fails = 0; entry.lastErr = null;
          item.resolve(result == null ? [] : result);
        } catch (rawError) {
          const error = rawError instanceof Error ? rawError : new Error(String(rawError));
          entry.fails++; entry.lastErr = connectionDiagnostic(error).code;
          if (sent && !isRead(item.path)) error.outcomeUnknown = true;
          item.reject(error);
        } finally {
          clearTimeout(item.timer); entry.touched = Date.now();
          Promise.resolve().then(() => audit({ kind: 'mikrotik.exec', tenantId: entry.tenantId,
            host: entry.cfg.host, port: entry.cfg.port, command: item.path,
            wordsCount: item.words.length, ok: !entry.lastErr, error: entry.lastErr,
            ms: Date.now() - started, at: new Date().toISOString() })).catch(() => {});
        }
      }
    } finally { entry.running = false; }
  }

  async function sendCommand(path, words = [], options = {}) {
    const tenantId = options.tenantId || options.ispId;
    if (!tenantId) throw failure('Missing tenantId for RouterOS command');
    if (typeof path !== 'string' || !path.startsWith('/') || !Array.isArray(words) || words.some(w => typeof w !== 'string')) throw failure('INVALID_COMMAND');
    const selector = { id: options.serverId || options.server || options.id, name: options.serverName || options.name, host: options.host, port: options.port };
    const entry = await getEntry(tenantId, selector);
    if (entry.queue.length >= 200) throw failure('QUEUE_FULL');
    const timeout = bounded(options.timeoutMs);
    return new Promise((resolve, reject) => {
      const item = { path, words, options, resolve, reject, deadline: Date.now() + timeout };
      item.timer = setTimeout(() => {
        item.expired = true;
        const index = entry.queue.indexOf(item);
        if (index >= 0) { entry.queue.splice(index, 1); reject(failure('QUEUE_TIMEOUT')); }
      }, timeout);
      entry.queue.push(item);
      void drain(entry);
    });
  }

  function retire(entry) {
    entry.retired = true; entry.cancel?.(failure('CONFIG_CHANGED')); close(entry);
    for (const item of entry.queue.splice(0)) { clearTimeout(item.timer); item.reject(failure('CONFIG_CHANGED')); }
    for (const timer of entry.schedules.values()) clearTimeout(timer);
  }
  async function invalidate(tenantId, id) {
    for (const [key, entry] of pool) {
      if (String(entry.tenantId) !== String(tenantId) || (id && String(entry.cfg.id) !== String(id))) continue;
      retire(entry); pool.delete(key);
    }
  }
  async function shutdown() {
    for (const entry of pool.values()) retire(entry);
    pool.clear();
  }
  const eviction = setInterval(() => {
    for (const [key, entry] of pool) if (!entry.running && !entry.queue.length && !entry.schedules.size && Date.now() - entry.touched > 600000) { close(entry); pool.delete(key); }
  }, 60000);
  eviction.unref();

  return {
    sendCommand, invalidate, shutdown,
    setConfigLoader: fn => { loadConfig = fn; },
    setAuditLogger: fn => { audit = fn || (async () => {}); },
    getStatus: () => [...pool.values()].map(e => ({ key: e.key, tenantId: e.tenantId, host: e.cfg.host, port: e.cfg.port,
      connected: e.connected, lastOkAt: e.lastOkAt, fails: e.fails, lastErr: e.lastErr, queueLength: e.queue.length, schedules: [...e.schedules.keys()] })),
    forceReconnect: async (tenantId, selector = {}) => {
      const entry = await getEntry(tenantId, selector);
      await invalidate(tenantId, entry.cfg.id);
      return sendCommand('/system/identity/print', [], { tenantId, ...selector, serverId: selector.id });
    },
    schedulePoll: async (tenantId, selector, name, path, words = [], intervalMs = 5000, staggerMs = 0) => {
      const entry = await getEntry(tenantId, selector);
      if (entry.schedules.has(name)) throw new Error('Schedule already exists');
      let stopped = false;
      const run = async () => {
        try { await sendCommand(path, words, { tenantId, ...selector }); } catch {}
        if (!stopped && !entry.retired) { const timer = setTimeout(run, intervalMs); timer.unref(); entry.schedules.set(name, timer); }
      };
      const timer = setTimeout(run, staggerMs); timer.unref(); entry.schedules.set(name, timer);
      return { stop: () => { stopped = true; clearTimeout(entry.schedules.get(name)); entry.schedules.delete(name); } };
    },
  };
}
module.exports = { ...createConnectionManager(), createConnectionManager };
