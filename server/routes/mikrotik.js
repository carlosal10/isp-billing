// routes/mikrotik.js
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");

// Uses your pooled, tenant-scoped manager
const { sendCommand } = require("../utils/mikrotikConnectionManager");
const Customer = require("../models/customers");
const { enableCustomerQueue, disableCustomerQueue, applyCustomerQueue } = require("../utils/mikrotikBandwidthManager");

// Track static session presence to approximate uptime between polls
const staticPresenceCache = new Map(); // key: `${tenantId}|${ip}` -> { firstSeen, lastSeen, mac }
const STATIC_PRESENCE_TTL_MS = 15 * 60 * 1000; // drop stale entries after 15 minutes

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  const parts = [];
  const days = Math.floor(totalSeconds / 86400);
  if (days) parts.push(`${days}d`);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  if (hours) parts.push(`${hours}h`);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (minutes) parts.push(`${minutes}m`);
  const seconds = totalSeconds % 60;
  if (!parts.length || seconds) parts.push(`${seconds}s`);
  return parts.slice(0, 3).join(" ");
}

// ---------- helpers ----------
const n = (v, d = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};
const s = (v, d = "") => (v == null ? d : String(v));
const qs = (k, v) => `?${k}=${v}`;
const w = (k, v) => `=${k}=${v}`;

const isYes = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === '1';
};

function mapPPPActiveRow(r = {}) {
  return {
    username: s(r.name || r.user || r.username),
    address: s(r.address || r["remote-address"] || r["ip-address"]),
    uptime: s(r.uptime),
    "bytes-in": n(r["bytes-in"] || r.rx || r["rx-bytes"]),
    "bytes-out": n(r["bytes-out"] || r.tx || r["tx-bytes"]),
    _raw: r,
  };
}

function mapHotspotActiveRow(r = {}) {
  return {
    username: s(r.user || r.name || r["mac-address"]),
    address: s(r.address || r["ip-address"]),
    uptime: s(r.uptime),
    "bytes-in": n(r["bytes-in"]),
    "bytes-out": n(r["bytes-out"]),
    _raw: r,
  };
}

// small delay helper used to space sequential calls
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Tenant-scoped print; never throws to the client
function pickServerId(req) {
  return (
    req.headers['x-isp-server'] ||
    req.headers['x-router-id'] ||
    req.query?.serverId ||
    req.query?.server ||
    null
  );
}

async function rosPrint(tenantId, path, words = [], timeoutMs = 10000, req = null) {
  try {
    const serverId = req ? pickServerId(req) : null;
    const out = await sendCommand(path, words, { tenantId, timeoutMs, serverId });
    return Array.isArray(out) ? out : [];
  } catch (e) {
    console.warn(`[MikroTik] print failed ${path}:`, e?.message || e);
    return [];
  }
}

function firstIpFromTarget(target) {
  if (!target) return "";
  const first = String(target).split(",")[0].trim();
  const ip = first.split("/")[0].trim();
  return ip;
}

// Rate limit to protect the router from UI spam
const limiter = rateLimit({ windowMs: 5000, max: 20, standardHeaders: true });

// ---------- routes ----------

// GET /api/mikrotik/status
router.get("/mikrotik/status", limiter, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    // sequential: identity (fast) -> resource (moderate) -> address (heavier)
    const idArr = await rosPrint(tenantId, "/system/identity/print", [], 10000, req);
    await delay(50);
    const resArr = await rosPrint(tenantId, "/system/resource/print", [], 10000, req);
    await delay(100);
    const ipArr = await rosPrint(tenantId, "/ip/address/print", [], 15000, req);

    const identity = idArr[0]?.name || "";
    const uptime = resArr[0]?.uptime || "";
    const routerIp = (ipArr.find((x) => x.address)?.address || "").split("/")[0] || "";

    const connected = Boolean(identity || uptime || routerIp);

    return res.json({
      ok: true,
      connected,
      identity,
      routerIp,
      uptime,
    });
  } catch (_e) {
    return res.json({ ok: true, connected: false, identity: "", routerIp: "", uptime: "" });
  }
});

// GET /api/mikrotik/ping
router.get("/mikrotik/ping", limiter, async (req, res) => {
  const idArr = await rosPrint(req.tenantId, "/system/identity/print", [], 10000, req);
  res.json({ ok: true, connected: Boolean(idArr[0]?.name) });
});

// GET /api/mikrotik/pppoe/active
router.get("/mikrotik/pppoe/active", limiter, async (req, res) => {
  const rows = await rosPrint(req.tenantId, "/ppp/active/print", [], 10000, req);
  res.json({ ok: true, count: rows.length, users: rows.map(mapPPPActiveRow) });
});

// GET /api/mikrotik/hotspot/active
router.get("/mikrotik/hotspot/active", limiter, async (req, res) => {
  const rows = await rosPrint(req.tenantId, "/ip/hotspot/active/print", [], 10000, req);
  res.json({ ok: true, count: rows.length, users: rows.map(mapHotspotActiveRow) });
});

// Alias routes for legacy clients
router.get("/pppoe/active", limiter, async (req, res) => {
  const rows = await rosPrint(req.tenantId, "/ppp/active/print", [], 10000, req);
  res.json({ ok: true, count: rows.length, users: rows.map(mapPPPActiveRow) });
});

router.get("/hotspot/active", limiter, async (req, res) => {
  const rows = await rosPrint(req.tenantId, "/ip/hotspot/active/print", [], 10000, req);
  res.json({ ok: true, count: rows.length, users: rows.map(mapHotspotActiveRow) });
});

// ---------- helper: private + LAN interface detection ----------
function isPrivateIPv4(ip) {
  try {
    const o = ip.split('.').map(Number);
    if (o[0] === 10) return true;
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
    if (o[0] === 192 && o[1] === 168) return true;
    return false;
  } catch { return false; }
}

// GET /api/mikrotik/queues/simple
router.get("/mikrotik/queues/simple", limiter, async (req, res) => {
  const tenantId = req.tenantId;
  const privateOnly = String(req.query?.privateOnly || 'true').toLowerCase() !== 'false';
  try {
    const rows = await rosPrint(tenantId, "/queue/simple/print", [], 10000, req);
    const mapped = (Array.isArray(rows) ? rows : []).map((q) => {
      const target = s(q?.target || q?.["target"] || "");
      const ip = firstIpFromTarget(target);
      return {
        name: s(q?.name),
        target,
        ip,
        comment: s(q?.comment),
        maxLimit: s(q?.["max-limit"] || q?.maxLimit || ""),
      };
    }).filter((r) => r.ip && (!privateOnly || isPrivateIPv4(r.ip)));
    return res.json({ ok: true, count: mapped.length, queues: mapped });
  } catch (e) {
    // Degrade gracefully so UI doesn't loop
    return res.json({ ok: false, count: 0, queues: [], error: e?.message || 'Failed to load queues' });
  }
});

// Alias (directly call handler logic by duplicating call)
router.get("/queues/simple", limiter, async (req, res) => {
  const tenantId = req.tenantId;
  const privateOnly = String(req.query?.privateOnly || 'true').toLowerCase() !== 'false';
  try {
    const rows = await rosPrint(tenantId, "/queue/simple/print", [], 10000, req);
    const mapped = (Array.isArray(rows) ? rows : []).map((q) => {
      const target = s(q?.target || q?.['target'] || "");
      const ip = firstIpFromTarget(target);
      return {
        name: s(q?.name),
        target,
        ip,
        comment: s(q?.comment),
        maxLimit: s(q?.["max-limit"] || q?.maxLimit || ""),
      };
    }).filter((r) => r.ip && (!privateOnly || isPrivateIPv4(r.ip)));
    return res.json({ ok: true, count: mapped.length, queues: mapped });
  } catch (e) {
    return res.json({ ok: false, count: 0, queues: [], error: e?.message || 'Failed to load queues' });
  }
});

// GET /api/mikrotik/arp (with filters)
// query: lanOnly=true, privateOnly=true, permanentOnly=true
router.get("/mikrotik/arp", limiter, async (req, res) => {
  const tenantId = req.tenantId;
  const lanOnly = String(req.query?.lanOnly || 'true').toLowerCase() !== 'false';
  const privateOnly = String(req.query?.privateOnly || 'true').toLowerCase() !== 'false';
  const permanentOnly = String(req.query?.permanentOnly || 'true').toLowerCase() !== 'false';
  try {
    // arp first (we need ARP data), then optional lan lists
    const arps = await rosPrint(tenantId, "/ip/arp/print", [], 12000, req);
    await delay(80);
    let bridges = [];
    let vlans = [];
    if (lanOnly) {
      bridges = await rosPrint(tenantId, "/interface/bridge/print", [], 8000, req);
      await delay(40);
      vlans = await rosPrint(tenantId, "/interface/vlan/print", [], 8000, req);
    }

    const lanIf = new Set([
      ...((Array.isArray(bridges) ? bridges : []).map((b) => s(b?.name)).filter(Boolean)),
      ...((Array.isArray(vlans) ? vlans : []).map((v) => s(v?.name || v?.interface)).filter(Boolean)),
    ]);
    const mapped = (Array.isArray(arps) ? arps : []).map((a) => ({
      address: s(a?.address),
      interface: s(a?.interface),
      mac: s(a?.['mac-address']),
      type: s(a?.type),
      dynamic: s(a?.dynamic),
      comment: s(a?.comment),
    })).filter((r) => {
      if (!r.address) return false;
      if (privateOnly && !isPrivateIPv4(r.address)) return false;
      if (lanOnly && r.interface && lanIf.size && !lanIf.has(r.interface)) return false;
      if (permanentOnly) {
        const dyn = String(r.dynamic || 'no').toLowerCase() === 'yes';
        const type = String(r.type || '').toLowerCase();
        if (dyn && type !== 'static') return false;
      }
      return true;
    });
    return res.json({ ok: true, count: mapped.length, arps: mapped });
  } catch (e) {
    return res.json({ ok: false, count: 0, arps: [], error: e?.message || 'Failed to load ARP' });
  }
});

// Alias with same logic (avoid internal re-dispatch)
router.get("/arp", limiter, async (req, res) => {
  const tenantId = req.tenantId;
  const lanOnly = String(req.query?.lanOnly || 'true').toLowerCase() !== 'false';
  const privateOnly = String(req.query?.privateOnly || 'true').toLowerCase() !== 'false';
  const permanentOnly = String(req.query?.permanentOnly || 'true').toLowerCase() !== 'false';
  try {
    const arps = await rosPrint(tenantId, "/ip/arp/print", [], 12000, req);
    await delay(80);
    let bridges = [];
    let vlans = [];
    if (lanOnly) {
      bridges = await rosPrint(tenantId, "/interface/bridge/print", [], 8000, req);
      await delay(40);
      vlans = await rosPrint(tenantId, "/interface/vlan/print", [], 8000, req);
    }

    const lanIf = new Set([
      ...((Array.isArray(bridges) ? bridges : []).map((b) => s(b?.name)).filter(Boolean)),
      ...((Array.isArray(vlans) ? vlans : []).map((v) => s(v?.name || v?.interface)).filter(Boolean)),
    ]);
    const mapped = (Array.isArray(arps) ? arps : []).map((a) => ({
      address: s(a?.address),
      interface: s(a?.interface),
      mac: s(a?.['mac-address']),
      type: s(a?.type),
      dynamic: s(a?.dynamic),
      comment: s(a?.comment),
    })).filter((r) => {
      if (!r.address) return false;
      if (privateOnly && !isPrivateIPv4(r.address)) return false;
      if (lanOnly && r.interface && lanIf.size && !lanIf.has(r.interface)) return false;
      if (permanentOnly) {
        const dyn = String(r.dynamic || 'no').toLowerCase() === 'yes';
        const type = String(r.type || '').toLowerCase();
        if (dyn && type !== 'static') return false;
      }
      return true;
    });
    return res.json({ ok: true, count: mapped.length, arps: mapped });
  } catch (e) {
    return res.json({ ok: false, count: 0, arps: [], error: e?.message || 'Failed to load ARP' });
  }
});

// Aggregate: GET /api/mikrotik/static/candidates
router.get("/mikrotik/static/candidates", limiter, async (req, res) => {
  const tenantId = req.tenantId;
  const include = String(req.query?.include || 'queues,lists,secrets,arp')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  // Defaults loosened to surface legacy data; caller can re-tighten via query
  const lanOnly = String(req.query?.lanOnly || 'false').toLowerCase() === 'true';
  const privateOnly = String(req.query?.privateOnly || 'false').toLowerCase() === 'true';
  const permanentOnly = String(req.query?.permanentOnly || 'false').toLowerCase() === 'true';
  const trustLists = String(req.query?.trustLists || 'true').toLowerCase() === 'true';
  try {
    const wantQueues = include.includes('queues');
    const wantLists = include.includes('lists');
    const wantSecrets = include.includes('secrets');
    const wantArp = include.includes('arp');

    // Ordered/sequential calls to avoid bursts
    const lists = wantLists ? await rosPrint(tenantId, "/ip/firewall/address-list/print", [], 15000, req) : [];
    await delay(60);
    const queues = wantQueues ? await rosPrint(tenantId, "/queue/simple/print", [], 15000, req) : [];
    await delay(120);
    const secrets = wantSecrets ? await rosPrint(tenantId, "/ppp/secret/print", [], 12000, req) : [];
    await delay(60);
    const arps = wantArp ? await rosPrint(tenantId, "/ip/arp/print", [], 15000, req) : [];
    await delay(40);
    let bridges = [], vlans = [];
    if (lanOnly) {
      bridges = await rosPrint(tenantId, "/interface/bridge/print", [], 8000, req);
      await delay(20);
      vlans = await rosPrint(tenantId, "/interface/vlan/print", [], 8000, req);
    }

    const lanIf = new Set([
      ...((Array.isArray(bridges) ? bridges : []).map((b) => s(b?.name)).filter(Boolean)),
      ...((Array.isArray(vlans) ? vlans : []).map((v) => s(v?.name || v?.interface)).filter(Boolean)),
    ]);
    const out = new Map();
    function push(ip, source, label) {
      const key = String(ip || '').trim();
      if (!key) return;
      if (privateOnly && !isPrivateIPv4(key)) return;
      const v = out.get(key) || { ip: key, sources: [], label: '' };
      if (!v.sources.includes(source)) v.sources.push(source);
      if (!v.label && label) v.label = label;
      out.set(key, v);
    }
    for (const q of queues || []) {
      const target = s(q?.target || q?.['target']);
      const ip = firstIpFromTarget(target);
      if (!ip) continue;
      push(ip, 'queue', s(q?.comment) || s(q?.name));
    }
    for (const r of lists || []) {
      const listName = s(r?.list);
      if (!listName) continue;
      if (!trustLists && listName !== 'STATIC_ALLOW' && listName !== 'STATIC_BLOCK') continue;
      const ip = s(r?.address);
      if (!ip) continue;
      push(ip, `list:${listName}`, `${listName}${r?.comment ? ' — ' + s(r.comment) : ''}`);
    }
    for (const sec of secrets || []) {
      const ip = s(sec?.['remote-address']);
      if (!ip) continue;
      push(ip, 'ppp-secret', `ppp secret ${s(sec?.name)}`);
    }
    for (const a of arps || []) {
      const ip = s(a?.address);
      if (!ip) continue;
      if (lanOnly && lanIf.size) {
        const iface = s(a?.interface);
        if (iface && !lanIf.has(iface)) continue;
      }
      if (permanentOnly) {
        const dyn = String(a?.dynamic || 'no').toLowerCase() === 'yes';
        const type = String(a?.type || '').toLowerCase();
        if (dyn && type !== 'static') continue;
      }
      push(ip, 'arp', `${s(a?.interface)}${a?.comment ? ' — ' + s(a.comment) : ''}`);
    }
    return res.json({ ok: true, count: out.size, candidates: Array.from(out.values()) });
  } catch (e) {
    return res.json({ ok: false, count: 0, candidates: [], error: e?.message || 'Failed to load candidates' });
  }
});

router.get("/static/candidates", limiter, async (req, res) => {
  const tenantId = req.tenantId;
  const include = String(req.query?.include || 'queues,lists,secrets,arp')
    .split(',').map((s2) => s2.trim().toLowerCase()).filter(Boolean);
  const lanOnly = String(req.query?.lanOnly || 'true').toLowerCase() !== 'false';
  const privateOnly = String(req.query?.privateOnly || 'true').toLowerCase() !== 'false';
  const permanentOnly = String(req.query?.permanentOnly || 'true').toLowerCase() !== 'false';
  const trustLists = String(req.query?.trustLists || 'true').toLowerCase() === 'true';
  try {
    const wantQueues = include.includes('queues');
    const wantLists = include.includes('lists');
    const wantSecrets = include.includes('secrets');
    const wantArp = include.includes('arp');

    // Ordered/sequential calls to avoid bursts
    const lists = wantLists ? await rosPrint(tenantId, "/ip/firewall/address-list/print", [], 15000, req) : [];
    await delay(60);
    const queues = wantQueues ? await rosPrint(tenantId, "/queue/simple/print", [], 15000, req) : [];
    await delay(120);
    const secrets = wantSecrets ? await rosPrint(tenantId, "/ppp/secret/print", [], 12000, req) : [];
    await delay(60);
    const arps = wantArp ? await rosPrint(tenantId, "/ip/arp/print", [], 15000, req) : [];
    await delay(40);
    let bridges = [], vlans = [];
    if (lanOnly) {
      bridges = await rosPrint(tenantId, "/interface/bridge/print", [], 8000, req);
      await delay(20);
      vlans = await rosPrint(tenantId, "/interface/vlan/print", [], 8000, req);
    }

    const lanIf = new Set([
      ...((Array.isArray(bridges) ? bridges : []).map((b) => s(b?.name)).filter(Boolean)),
      ...((Array.isArray(vlans) ? vlans : []).map((v) => s(v?.name || v?.interface)).filter(Boolean)),
    ]);
    const out = new Map();
    function push(ip, source, label) {
      const key = String(ip || '').trim();
      if (!key) return;
      if (privateOnly && !isPrivateIPv4(key)) return;
      const v = out.get(key) || { ip: key, sources: [], label: '' };
      if (!v.sources.includes(source)) v.sources.push(source);
      if (!v.label && label) v.label = label;
      out.set(key, v);
    }
    for (const q of queues || []) {
      const target = s(q?.target || q?.['target']);
      const ip = firstIpFromTarget(target);
      if (!ip) continue;
      push(ip, 'queue', s(q?.comment) || s(q?.name));
    }
    for (const r of lists || []) {
      const listName = s(r?.list);
      if (!listName) continue;
      if (!trustLists && listName !== 'STATIC_ALLOW' && listName !== 'STATIC_BLOCK') continue;
      const ip = s(r?.address);
      if (!ip) continue;
      push(ip, `list:${listName}`, `${listName}${r?.comment ? ' — ' + s(r.comment) : ''}`);
    }
    for (const sec of secrets || []) {
      const ip = s(sec?.['remote-address']);
      if (!ip) continue;
      push(ip, 'ppp-secret', `ppp secret ${s(sec?.name)}`);
    }
    for (const a of arps || []) {
      const ip = s(a?.address);
      if (!ip) continue;
      if (lanOnly && lanIf.size) {
        const iface = s(a?.interface);
        if (iface && !lanIf.has(iface)) continue;
      }
      if (permanentOnly) {
        const dyn = String(a?.dynamic || 'no').toLowerCase() === 'yes';
        const type = String(a?.type || '').toLowerCase();
        if (dyn && type !== 'static') continue;
      }
      push(ip, 'arp', `${s(a?.interface)}${a?.comment ? ' — ' + s(a.comment) : ''}`);
    }
    return res.json({ ok: true, count: out.size, candidates: Array.from(out.values()) });
  } catch (e) {
    return res.json({ ok: false, count: 0, candidates: [], error: e?.message || 'Failed to load candidates' });
  }
});

// GET /api/mikrotik/static/active
router.get("/mikrotik/static/active", limiter, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    // lists first (light), then queues, then arp
    const lists = await rosPrint(tenantId, "/ip/firewall/address-list/print", [], 12000, req);
    await delay(60);
    const queues = await rosPrint(tenantId, "/queue/simple/print", [], 15000, req);
    await delay(120);
    const arps = await rosPrint(tenantId, "/ip/arp/print", [], 15000, req);

    // Build candidates from queues (prefer /32 targets)
    const ips = new Map(); // ip -> accountName (queue name) | null
    for (const q of Array.isArray(queues) ? queues : []) {
      const name = s(q?.name);
      const ip = firstIpFromTarget(q?.target || q?.["target"] || "");
      if (!ip) continue;
      if (!ips.has(ip)) ips.set(ip, name || null);
    }
    // Add from STATIC_ALLOW list if not already present
    for (const r of Array.isArray(lists) ? lists : []) {
      if (s(r?.list) !== "STATIC_ALLOW") continue;
      const ip = s(r?.address);
      if (ip && !ips.has(ip)) ips.set(ip, null);
    }

    const arpMap = new Map((Array.isArray(arps) ? arps : []).map((a) => [s(a?.address), a]));

    // Fill in account numbers from DB where possible
    const wantIps = [...ips.keys()];
    const customers = await Customer.find({
      tenantId,
      connectionType: 'static',
      'staticConfig.ip': { $in: wantIps },
    }).select('accountNumber staticConfig.ip').lean();
    const ipToAcct = new Map(customers.map((c) => [s(c?.staticConfig?.ip), s(c?.accountNumber)]));

    const users = [];
    for (const [ip, qName] of ips) {
      const a = arpMap.get(ip);
      if (!a) continue; // Only include online (present in ARP)
      const username = qName || ipToAcct.get(ip) || ip.replace(/\./g, '-');
      users.push({
        username,
        address: ip,
        uptime: s(a?.['last-seen'] || a?.uptime || ''),
        'bytes-in': 0,
        'bytes-out': 0,
        _raw: { source: 'static', arp: a },
      });
    }

    return res.json({ ok: true, count: users.length, users });
  } catch (e) {
    console.warn('[MikroTik] static/active failed:', e?.message || e);
    return res.json({ ok: true, count: 0, users: [] });
  }
});

// Alias route
router.get("/static/active", limiter, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    // sequential: queues -> lists -> arp (but keep reasonable spacing)
    const queues = await rosPrint(tenantId, "/queue/simple/print", [], 15000, req);
    await delay(60);
    const lists = await rosPrint(tenantId, "/ip/firewall/address-list/print", [], 12000, req);
    await delay(120);
    const arps = await rosPrint(tenantId, "/ip/arp/print", [], 15000, req);

    const queueByIp = new Map();
    for (const q of Array.isArray(queues) ? queues : []) {
      const ip = firstIpFromTarget(q?.target || q?.["target"] || "");
      if (!ip) continue;
      queueByIp.set(ip, q);
    }

    const allowSet = new Set();
    const blockSet = new Set();
    for (const r of Array.isArray(lists) ? lists : []) {
      const ip = s(r?.address);
      if (!ip) continue;
      const listName = s(r?.list);
      if (listName === "STATIC_ALLOW") allowSet.add(ip);
      if (listName === "STATIC_BLOCK") blockSet.add(ip);
    }

    const arpMap = new Map((Array.isArray(arps) ? arps : []).map((a) => [s(a?.address), a]));

    // Load static customers to map IP -> accountNumber (fallback)
    const customers = await Customer.find({
      tenantId,
      connectionType: 'static',
    })
      .select('accountNumber status name phone plan staticConfig.ip')
      .populate('plan', 'name')
      .lean();

    const customerByIp = new Map();
    for (const c of customers) {
      const ip = s(c?.staticConfig?.ip);
      if (ip) customerByIp.set(ip, c);
    }

    const universe = new Set([
      ...queueByIp.keys(),
      ...allowSet,
      ...blockSet,
      ...customerByIp.keys(),
    ]);

    const now = Date.now();
    const users = [];
    for (const ip of universe) {
      const q = queueByIp.get(ip) || null;
      const a = arpMap.get(ip) || null;
      const c = customerByIp.get(ip) || null;
      const cacheKey = `${req.tenantId}|${ip}`;

      if (!a) {
        staticPresenceCache.delete(cacheKey);
        continue; // only treat entries with live ARP bindings as active
      }

      const mac = s(a?.["mac-address"] || "");
      const cached = staticPresenceCache.get(cacheKey);
      if (!cached || cached.mac !== mac) {
        staticPresenceCache.set(cacheKey, { firstSeen: now, lastSeen: now, mac });
      } else {
        cached.lastSeen = now;
      }

      const sessionMeta = staticPresenceCache.get(cacheKey);
      const uptimeMs = sessionMeta ? now - sessionMeta.firstSeen : 0;

      const queueDisabled = q ? isYes(q?.disabled) : false;
      const accountNumber = c?.accountNumber || s(q?.name || "") || ip.replace(/\./g, "-");
      const planName = c?.plan?.name || null;
      const lastSeen = s(a?.["last-seen"] || "");
      const status = (c?.status || (queueDisabled ? "inactive" : "active")) || null;

      const bytesIn = n(q?.["bytes-in"] || q?.rx || q?.["rx-bytes"]);
      const bytesOut = n(q?.["bytes-out"] || q?.tx || q?.["tx-bytes"]);
      const totalBytes = n(q?.["total-bytes"] || q?.bytes || 0);
      const queueRate = s(q?.["max-limit"] || q?.maxLimit || "");

      users.push({
        username: accountNumber,
        accountNumber,
        address: ip,
        ip,
        queueDisabled,
        status,
        inAllow: allowSet.has(ip),
        inBlock: blockSet.has(ip),
        queueName: s(q?.name || ""),
        queueRate,
        totalBytes,
        "bytes-in": bytesIn,
        "bytes-out": bytesOut,
        uptime: formatDuration(uptimeMs),
        uptimeMs,
        lastSeen,
        mac,
        interface: s(a?.interface || ""),
        planName: planName || undefined,
        name: c?.name || undefined,
        phone: c?.phone || undefined,
      });
    }

    // prune cached entries that haven't been observed recently
    for (const [key, meta] of staticPresenceCache.entries()) {
      if (!meta || !Number.isFinite(meta.lastSeen)) {
        staticPresenceCache.delete(key);
        continue;
      }
      if (now - meta.lastSeen > STATIC_PRESENCE_TTL_MS) {
        staticPresenceCache.delete(key);
      }
    }

    users.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
    return res.json({ ok: true, count: users.length, users });
  } catch (e) {
    console.warn("[MikroTik] static/active failed:", e?.message || e);
    return res.json({ ok: true, count: 0, users: [] });
  }
});

// ----- Manual control: enable/disable/disconnect PPPoE user by accountNumber -----
router.post("/pppoe/:account/enable", limiter, async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const serverId = pickServerId(req);
    // Trim raw account and build search keys including aliases
    const rawName = String(req.params.account || '').trim();
    const searchKeys = new Set([rawName]);
    try {
      const doc = await Customer.findOne({ tenantId, $or: [{ accountNumber: rawName }, { accountAliases: rawName }] }).lean();
      if (doc) {
        if (doc.accountNumber) searchKeys.add(String(doc.accountNumber).trim());
        for (const alias of Array.isArray(doc.accountAliases) ? doc.accountAliases : []) {
          const aliasTrim = String(alias || '').trim();
          if (aliasTrim) searchKeys.add(aliasTrim);
        }
      }
    } catch (_) {}
    let secret = null;
    for (const key of searchKeys) {
      const rows = await sendCommand("/ppp/secret/print", [qs("name", key)], { tenantId, timeoutMs: 10000, serverId });
      if (Array.isArray(rows) && rows[0]) {
        secret = rows[0];
        break;
      }
    }
    if (!secret) return res.status(404).json({ ok: false, error: "User not found" });
    const id = secret[".id"] || secret.id || secret.numbers;
    await sendCommand("/ppp/secret/set", [w("numbers", id), w("disabled", "no")], { tenantId, timeoutMs: 10000, serverId });
    return res.json({ ok: true, message: "Enabled" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Enable failed" });
  }
});

router.post("/pppoe/:account/disable", limiter, async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const serverId = pickServerId(req);
    // Trim raw account and build search keys including aliases
    const rawName = String(req.params.account || '').trim();
    const searchKeys = new Set([rawName]);
    try {
      const doc = await Customer.findOne({ tenantId, $or: [{ accountNumber: rawName }, { accountAliases: rawName }] }).lean();
      if (doc) {
        if (doc.accountNumber) searchKeys.add(String(doc.accountNumber).trim());
        for (const alias of Array.isArray(doc.accountAliases) ? doc.accountAliases : []) {
          const aliasTrim = String(alias || '').trim();
          if (aliasTrim) searchKeys.add(aliasTrim);
        }
      }
    } catch (_) {}
    let secret = null;
    let secretName = rawName;
    for (const key of searchKeys) {
      const rows = await sendCommand("/ppp/secret/print", [qs("name", key)], { tenantId, timeoutMs: 10000, serverId });
      if (Array.isArray(rows) && rows[0]) {
        secret = rows[0];
        secretName = key;
        break;
      }
    }
    if (!secret) return res.status(404).json({ ok: false, error: "User not found" });
    const id = secret[".id"] || secret.id || secret.numbers;
    await sendCommand("/ppp/secret/set", [w("numbers", id), w("disabled", "yes")], { tenantId, timeoutMs: 10000, serverId });
    // optional disconnect active
    if (String(req.query.disconnect || "true").toLowerCase() !== "false") {
      const act = await sendCommand("/ppp/active/print", [qs("name", secretName)], { tenantId, timeoutMs: 8000, serverId });
      if (Array.isArray(act) && act[0]) {
        const aid = act[0][".id"] || act[0].id || act[0].numbers;
        await sendCommand("/ppp/active/remove", [w(".id", aid)], { tenantId, timeoutMs: 8000, serverId });
      }
    }
    return res.json({ ok: true, message: "Disabled" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Disable failed" });
  }
});

// ----- Static IP queue apply/enable/disable by accountNumber -----
router.post("/static/:account/apply-queue", limiter, async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const serverId = pickServerId(req);
    const name = String(req.params.account);
    const rate = String(req.body.rateLimit || "10M/2M");
    // Use simple queue with name = account
    // Create or update
    const list = await sendCommand("/queue/simple/print", [qs("name", name)], { tenantId, timeoutMs: 8000, serverId });
    if (Array.isArray(list) && list[0]) {
      const id = list[0][".id"] || list[0].id || list[0].numbers;
      await sendCommand("/queue/simple/set", [w("numbers", id), w("max-limit", rate)], { tenantId, timeoutMs: 8000, serverId });
    } else {
      const target = String(req.body.target || ""); // e.g., 192.0.2.10/32
      if (!target) return res.status(400).json({ ok: false, error: "target (ip/mask) required" });
      await sendCommand(
        "/queue/simple/add",
        [w("name", name), w("target", target), w("max-limit", rate)],
        { tenantId, timeoutMs: 8000, serverId }
      );
    }
    return res.json({ ok: true, message: "Queue applied" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Queue apply failed" });
  }
});

router.post("/static/:account/enable-queue", limiter, async (req, res) => {
  try {
    const serverId = pickServerId(req);
    const rows = await sendCommand("/queue/simple/print", [qs("name", String(req.params.account))], { tenantId: req.tenantId, timeoutMs: 8000, serverId });
    if (!Array.isArray(rows) || !rows[0]) return res.status(404).json({ ok: false, error: "Queue not found" });
    const id = rows[0][".id"] || rows[0].id || rows[0].numbers;
    await sendCommand("/queue/simple/enable", [w("numbers", id)], { tenantId: req.tenantId, timeoutMs: 8000, serverId });

    // persist + sync firewall lists
    try {
      const customerDoc = await Customer.findOne({ tenantId: req.tenantId, accountNumber: String(req.params.account), connectionType: 'static' }).populate('plan');
      if (customerDoc) {
        await Customer.updateOne({ _id: customerDoc._id }, { $set: { status: 'active', updatedAt: new Date() } });
        const payload = customerDoc.toObject();
        payload.status = 'active';
        await enableCustomerQueue(payload, (customerDoc.plan && typeof customerDoc.plan === 'object') ? customerDoc.plan : null)
          .catch(() => {});
      }
    } catch (postErr) {
      console.warn('[Mikrotik] enable queue post-processing failed:', postErr?.message || postErr);
    }

    res.json({ ok: true, message: "Queue enabled" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "Enable failed" });
  }
});

router.post("/static/:account/disable-queue", limiter, async (req, res) => {
  try {
    const serverId = pickServerId(req);
    const rows = await sendCommand("/queue/simple/print", [qs("name", String(req.params.account))], { tenantId: req.tenantId, timeoutMs: 8000, serverId });
    if (!Array.isArray(rows) || !rows[0]) return res.status(404).json({ ok: false, error: "Queue not found" });
    const id = rows[0][".id"] || rows[0].id || rows[0].numbers;
    await sendCommand("/queue/simple/disable", [w("numbers", id)], { tenantId: req.tenantId, timeoutMs: 8000, serverId });

    // persist + sync firewall lists
    try {
      const customerDoc = await Customer.findOne({ tenantId: req.tenantId, accountNumber: String(req.params.account), connectionType: 'static' }).populate('plan');
      if (customerDoc) {
        await Customer.updateOne({ _id: customerDoc._id }, { $set: { status: 'inactive', updatedAt: new Date() } });
        const payload = customerDoc.toObject();
        payload.status = 'inactive';
        await disableCustomerQueue(payload).catch(() => {});
      }
    } catch (postErr) {
      console.warn('[Mikrotik] disable queue post-processing failed:', postErr?.message || postErr);
    }

    res.json({ ok: true, message: "Queue disabled" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "Disable failed" });
  }
});

// GET /api/mikrotik/online  (combined counts)
router.get("/mikrotik/online", limiter, async (req, res) => {
  const tenantId = req.tenantId;
  // PPPoE (likely heavier) first, then hotspot, small pause between
  const pppoe = await rosPrint(tenantId, "/ppp/active/print", [], 12000, req);
  await delay(100);
  const hotspot = await rosPrint(tenantId, "/ip/hotspot/active/print", [], 12000, req);
  res.json({
    ok: true,
    pppoe: { count: pppoe.length },
    hotspot: { count: hotspot.length },
    total: pppoe.length + hotspot.length,
  });
});

module.exports = router;
