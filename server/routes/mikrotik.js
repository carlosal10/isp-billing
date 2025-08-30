// routes/mikrotik.js
const express = require('express');
const router = express.Router();

// Uses the same helper you already import elsewhere
// (adjust path if your utils file lives elsewhere)
const { sendCommand } = require('../utils/mikrotikConnectionManager');

// ---------- helpers ----------
function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}
function s(v, d = '') {
  return v == null ? d : String(v);
}
function mapPPPActiveRow(r = {}) {
  return {
    // normalized fields used by your dashboard
    username: s(r.name || r.user || r.username || ''),
    address: s(r.address || r['remote-address'] || r['ip-address'] || ''),
    uptime: s(r.uptime || ''),
    'bytes-in': n(r['bytes-in'] || r.rx || r['rx-bytes']),
    'bytes-out': n(r['bytes-out'] || r.tx || r['tx-bytes']),
    // keep raw row in case you want to inspect later
    _raw: r,
  };
}
function mapHotspotActiveRow(r = {}) {
  return {
    username: s(r.user || r['user'] || r.name || r['mac-address'] || ''),
    address: s(r.address || r['address'] || r['ip-address'] || ''),
    uptime: s(r.uptime || ''),
    'bytes-in': n(r['bytes-in']),
    'bytes-out': n(r['bytes-out']),
    _raw: r,
  };
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
