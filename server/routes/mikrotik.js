// routes/mikrotik.js
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");

// Uses your pooled, tenant-scoped manager
const { sendCommand } = require("../utils/mikrotikConnectionManager");
const Customer = require("../models/customers");

// ---------- helpers ----------
const n = (v, d = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};
const s = (v, d = "") => (v == null ? d : String(v));
const qs = (k, v) => `?${k}=${v}`;
const w = (k, v) => `=${k}=${v}`;

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

// Tenant-scoped print; never throws to the client
async function rosPrint(tenantId, path, words = [], timeoutMs = 10000) {
  try {
    const out = await sendCommand(path, words, { tenantId, timeoutMs });
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
    const [idArr, resArr, ipArr] = await Promise.all([
      rosPrint(tenantId, "/system/identity/print"),
      rosPrint(tenantId, "/system/resource/print"),
      rosPrint(tenantId, "/ip/address/print"),
    ]);

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
      // cpuLoad: resArr[0]?.["cpu-load"] ?? null,
      // freeMem: resArr[0]?.["free-memory"] ?? null,
    });
  } catch (_e) {
    return res.json({ ok: true, connected: false, identity: "", routerIp: "", uptime: "" });
  }
});

// GET /api/mikrotik/ping
router.get("/mikrotik/ping", limiter, async (req, res) => {
  const idArr = await rosPrint(req.tenantId, "/system/identity/print");
  res.json({ ok: true, connected: Boolean(idArr[0]?.name) });
});

// GET /api/mikrotik/pppoe/active
router.get("/mikrotik/pppoe/active", limiter, async (req, res) => {
  const rows = await rosPrint(req.tenantId, "/ppp/active/print");
  res.json({ ok: true, count: rows.length, users: rows.map(mapPPPActiveRow) });
});

// GET /api/mikrotik/hotspot/active
router.get("/mikrotik/hotspot/active", limiter, async (req, res) => {
  const rows = await rosPrint(req.tenantId, "/ip/hotspot/active/print");
  res.json({ ok: true, count: rows.length, users: rows.map(mapHotspotActiveRow) });
});

// Alias routes for legacy clients
router.get("/pppoe/active", limiter, async (req, res) => {
  const rows = await rosPrint(req.tenantId, "/ppp/active/print");
  res.json({ ok: true, count: rows.length, users: rows.map(mapPPPActiveRow) });
});

router.get("/hotspot/active", limiter, async (req, res) => {
  const rows = await rosPrint(req.tenantId, "/ip/hotspot/active/print");
  res.json({ ok: true, count: rows.length, users: rows.map(mapHotspotActiveRow) });
});

// GET /api/mikrotik/queues/simple
router.get("/mikrotik/queues/simple", limiter, async (req, res) => {
  const tenantId = req.tenantId;
  const privateOnly = String(req.query?.privateOnly || 'true').toLowerCase() !== 'false';
  function isPrivate(ip) {
    try {
      const o = ip.split('.').map(Number);
      if (o[0] === 10) return true;
      if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
      if (o[0] === 192 && o[1] === 168) return true;
      return false;
    } catch { return false; }
  }
  try {
    const rows = await rosPrint(tenantId, "/queue/simple/print");
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
    }).filter((r) => r.ip && (!privateOnly || isPrivate(r.ip)));
    res.json({ ok: true, count: mapped.length, queues: mapped });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || 'Failed to load queues' });
  }
});

// Alias
router.get("/queues/simple", limiter, async (req, res) => {
  req.url = "/mikrotik/queues/simple";
  return router.handle(req, res);
});

// GET /api/mikrotik/static/active
router.get("/mikrotik/static/active", limiter, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const [queues, lists, arps] = await Promise.all([
      rosPrint(tenantId, "/queue/simple/print"),
      rosPrint(tenantId, "/ip/firewall/address-list/print"),
      rosPrint(tenantId, "/ip/arp/print"),
    ]);

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
  const { data } = { data: null };
  // Delegate by calling the above logic (we can't call router handler directly), so just duplicate minimal call
  const tenantId = req.tenantId;
  try {
    const [queues, lists, arps] = await Promise.all([
      rosPrint(tenantId, "/queue/simple/print"),
      rosPrint(tenantId, "/ip/firewall/address-list/print"),
      rosPrint(tenantId, "/ip/arp/print"),
    ]);
    const ips = new Map();
    for (const q of Array.isArray(queues) ? queues : []) {
      const name = s(q?.name);
      const ip = firstIpFromTarget(q?.target || q?.["target"] || "");
      if (!ip) continue;
      if (!ips.has(ip)) ips.set(ip, name || null);
    }
    for (const r of Array.isArray(lists) ? lists : []) {
      if (s(r?.list) !== "STATIC_ALLOW") continue;
      const ip = s(r?.address);
      if (ip && !ips.has(ip)) ips.set(ip, null);
    }
    const arpMap = new Map((Array.isArray(arps) ? arps : []).map((a) => [s(a?.address), a]));
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
      if (!a) continue;
      const username = qName || ipToAcct.get(ip) || ip.replace(/\./g, '-');
      users.push({ username, address: ip, uptime: s(a?.['last-seen'] || a?.uptime || ''), 'bytes-in': 0, 'bytes-out': 0 });
    }
    return res.json({ ok: true, count: users.length, users });
  } catch (_e) {
    return res.json({ ok: true, count: 0, users: [] });
  }
});

// ----- Manual control: enable/disable/disconnect PPPoE user by accountNumber -----
router.post("/pppoe/:account/enable", limiter, async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const name = String(req.params.account);
    // find secret id by name
    const rows = await sendCommand("/ppp/secret/print", [qs("name", name)], { tenantId, timeoutMs: 10000 });
    if (!Array.isArray(rows) || rows.length === 0) return res.status(404).json({ ok: false, error: "User not found" });
    const id = rows[0][".id"] || rows[0].id || rows[0].numbers;
    await sendCommand("/ppp/secret/set", [w("numbers", id), w("disabled", "no")], { tenantId, timeoutMs: 10000 });
    return res.json({ ok: true, message: "Enabled" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Enable failed" });
  }
});

router.post("/pppoe/:account/disable", limiter, async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const name = String(req.params.account);
    const rows = await sendCommand("/ppp/secret/print", [qs("name", name)], { tenantId, timeoutMs: 10000 });
    if (!Array.isArray(rows) || rows.length === 0) return res.status(404).json({ ok: false, error: "User not found" });
    const id = rows[0][".id"] || rows[0].id || rows[0].numbers;
    await sendCommand("/ppp/secret/set", [w("numbers", id), w("disabled", "yes")], { tenantId, timeoutMs: 10000 });
    // optional disconnect active
    if (String(req.query.disconnect || "true").toLowerCase() !== "false") {
      const act = await sendCommand("/ppp/active/print", [qs("name", name)], { tenantId, timeoutMs: 8000 });
      if (Array.isArray(act) && act[0]) {
        const aid = act[0][".id"] || act[0].id || act[0].numbers;
        await sendCommand("/ppp/active/remove", [w(".id", aid)], { tenantId, timeoutMs: 8000 });
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
    const name = String(req.params.account);
    const rate = String(req.body.rateLimit || "10M/2M");
    // Use simple queue with name = account
    // Create or update
    const list = await sendCommand("/queue/simple/print", [qs("name", name)], { tenantId, timeoutMs: 8000 });
    if (Array.isArray(list) && list[0]) {
      const id = list[0][".id"] || list[0].id || list[0].numbers;
      await sendCommand("/queue/simple/set", [w("numbers", id), w("max-limit", rate)], { tenantId, timeoutMs: 8000 });
    } else {
      const target = String(req.body.target || ""); // e.g., 192.0.2.10/32
      if (!target) return res.status(400).json({ ok: false, error: "target (ip/mask) required" });
      await sendCommand(
        "/queue/simple/add",
        [w("name", name), w("target", target), w("max-limit", rate)],
        { tenantId, timeoutMs: 8000 }
      );
    }
    return res.json({ ok: true, message: "Queue applied" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Queue apply failed" });
  }
});

router.post("/static/:account/enable-queue", limiter, async (req, res) => {
  try {
    const rows = await sendCommand("/queue/simple/print", [qs("name", String(req.params.account))], { tenantId: req.tenantId, timeoutMs: 8000 });
    if (!Array.isArray(rows) || !rows[0]) return res.status(404).json({ ok: false, error: "Queue not found" });
    const id = rows[0][".id"] || rows[0].id || rows[0].numbers;
    await sendCommand("/queue/simple/enable", [w("numbers", id)], { tenantId: req.tenantId, timeoutMs: 8000 });
    res.json({ ok: true, message: "Queue enabled" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "Enable failed" });
  }
});

router.post("/static/:account/disable-queue", limiter, async (req, res) => {
  try {
    const rows = await sendCommand("/queue/simple/print", [qs("name", String(req.params.account))], { tenantId: req.tenantId, timeoutMs: 8000 });
    if (!Array.isArray(rows) || !rows[0]) return res.status(404).json({ ok: false, error: "Queue not found" });
    const id = rows[0][".id"] || rows[0].id || rows[0].numbers;
    await sendCommand("/queue/simple/disable", [w("numbers", id)], { tenantId: req.tenantId, timeoutMs: 8000 });
    res.json({ ok: true, message: "Queue disabled" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "Disable failed" });
  }
});

// GET /api/mikrotik/online  (combined counts)
router.get("/mikrotik/online", limiter, async (req, res) => {
  const tenantId = req.tenantId;
  const [pppoe, hotspot] = await Promise.all([
    rosPrint(tenantId, "/ppp/active/print"),
    rosPrint(tenantId, "/ip/hotspot/active/print"),
  ]);
  res.json({
    ok: true,
    pppoe: { count: pppoe.length },
    hotspot: { count: hotspot.length },
    total: pppoe.length + hotspot.length,
  });
});

module.exports = router;
