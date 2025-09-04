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
