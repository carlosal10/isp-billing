// routes/mikrotik.js
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");

// Uses your pooled, tenant-scoped manager
const { sendCommand } = require("../utils/mikrotikConnectionManager");

// ---------- helpers ----------
const n = (v, d = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};
const s = (v, d = "") => (v == null ? d : String(v));
const qs = (k, v) => `?${k}=${v}`;

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
