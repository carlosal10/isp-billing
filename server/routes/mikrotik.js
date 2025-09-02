// routes/mikrotik.js
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");

// Uses your pooled, tenant-scoped manager
const { sendCommand } = require("../utils/mikrotikConnectionManager");

// ---------- small helpers ----------
const n = (v, d = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};
const s = (v, d = "") => (v == null ? d : String(v));

const qs = (k, v) => `?${k}=${v}`;
// const w  = (k, v) => `=${k}=${v}`; // not needed here, but keep pattern handy

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

// Make a RouterOS print call safely; pass tenant and never throw to client
async function rosPrint(tenantId, path, words = [], timeoutMs = 10000) {
  try {
    const out = await sendCommand(path, words, { tenantId, timeoutMs });
    return Array.isArray(out) ? out : [];
  } catch (e) {
    console.warn(`[MikroTik] print failed ${path}:`, e?.message || e);
    return [];
  }
}

// Basic rate limit to protect the router from UI spam
const limiter = rateLimit({ windowMs: 5_000, max: 20, standardHeaders: true });

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
    const routerIp =
      (ipArr.find((x) => x.address)?.address || "").split("/")[0] || "";

    // If identity or uptime or an IP came back, we consider it connected.
    const connected = Boolean(identity || uptime || routerIp);

    return res.json({
      ok: true,
      connected,
      identity,
      routerIp,
      uptime,
      // You can add cpu-load, free-memory, etc. if you want:
      // cpuLoad: resArr[0]?.["cpu-load"] ?? null,
      // freeMem: resArr[0]?.["free-memory"] ?? null,
    });
  } catch (_e) {
    // return a calm disconnected state
    return res.json({ ok: true, connected: false, identity: "", routerIp: "", uptime: "" });
  }
});

// Lightweight health
// GET /api/mikrotik/ping
router.get("/mikrotik/ping", limiter, async (req, res) => {
  const idArr = await rosPrint(req.tenantId, "/system/identity/print");
  res.json({ ok: true, connected: Boolean(idArr[0]?.name) });
});

// PPPoE active
// GET /api/mikrotik/pppoe/active
router.get("/mikrotik/pppoe/active", limiter, async (req, res) => {
  const rows = await rosPrint(req.tenantId, "/ppp/active/print");
  res.json({ ok: true, count: rows.length, users: rows.map(mapPPPActiveRow) });
});

// Hotspot active
// GET /api/mikrotik/hotspot/active
router.get("/mikrotik/hotspot/active", limiter, async (req, res) => {
  const rows = await rosPrint(req.tenantId, "/ip/hotspot/active/print");
  res.json({ ok: true, count: rows.length, users: rows.map(mapHotspotActiveRow) });
});

// Combined (handy for one dashboard widget)
// GET /api/mikrotik/online
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

module.exports = router;  };
}

// Make a RouterOS print call safely; never throw to the client
async function rosPrint(path, words) {
  try {
    const out = await sendCommand(path, words); // words optional
    return Array.isArray(out) ? out : [];
  } catch (e) {
    console.warn(`[MikroTik] print failed ${path}:`, e?.message || e);
    return [];
  }
}

// ---------- routes ----------

// /api/mikrotik/status
router.get('/mikrotik/status', async (_req, res) => {
  try {
    const [idArr, resArr] = await Promise.all([
      rosPrint('/system/identity/print'),
      rosPrint('/system/resource/print'),
    ]);

    const identity = idArr[0]?.name || '';
    const uptime = resArr[0]?.uptime || '';
    // Best-effort router IP (optional)
    const ipArr = await rosPrint('/ip/address/print');
    const routerIp = ipArr.find(x => x['interface'] || x['address'])?.address?.split('/')[0] || '';

    // If we could read identity, we’re connected.
    const connected = Boolean(identity || uptime || routerIp);
    return res.json({
      connected,
      identity,
      routerIp: routerIp || process.env.MIKROTIK_HOST || '',
      uptime,
    });
  } catch (e) {
    // Hard fail -> just say disconnected (200 keeps UI calm)
    return res.json({
      connected: false,
      identity: '',
      routerIp: process.env.MIKROTIK_HOST || '',
      uptime: '',
    });
  }
});

// /api/mikrotik/ping (lightweight health)
router.get('/mikrotik/ping', async (_req, res) => {
  const idArr = await rosPrint('/system/identity/print');
  res.json({ connected: Boolean(idArr[0]?.name) });
});

// /api/mikrotik/pppoe/active
router.get('/mikrotik/pppoe/active', async (_req, res) => {
  const rows = await rosPrint('/ppp/active/print');
  res.json(rows.map(mapPPPActiveRow));
});

// Alias your UI calls directly: /api/pppoe/active
router.get('/pppoe/active', async (_req, res) => {
  const rows = await rosPrint('/ppp/active/print');
  res.json(rows.map(mapPPPActiveRow));
});

// Optional: /api/hotspot/active
router.get('/hotspot/active', async (_req, res) => {
  const rows = await rosPrint('/ip/hotspot/active/print');
  res.json(rows.map(mapHotspotActiveRow));
});

module.exports = router;
