// routes/mikrotikProfiles.js
// Lightweight endpoint to list PPP/PPPoE profiles.
// Improvements:
// - honor per-request server selector (x-isp-server / x-router-id / ?serverId)
// - defensive normalization and stable ids
// - explicit timeouts and consistent error responses

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { sendCommand } = require('../utils/mikrotikConnectionManager');

const limiter = rateLimit({ windowMs: 5000, max: 20, standardHeaders: true });

// pick server id / selector from headers/query (copied pattern)
function pickServerId(req) {
  return (
    req.headers['x-isp-server'] ||
    req.headers['x-router-id'] ||
    req.query?.serverId ||
    req.query?.server ||
    null
  );
}

function normalizeProfiles(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.profiles) ? raw.profiles : []);
  return arr
    .map((p, i) => {
      if (!p || typeof p !== 'object') return null;
      const id = String(p['.id'] ?? p.id ?? p._id ?? `idx_${i}`);
      const name = String(p.name ?? p.profile ?? p.profileName ?? p.title ?? id ?? `profile_${i}`);
      const localAddress = p['local-address'] ?? p.localAddress ?? null;
      const rateLimit = p['rate-limit'] ?? p.rateLimit ?? '';
      // include raw minimal for debugging if needed
      return { id, name, localAddress, rateLimit, _raw: undefined };
    })
    .filter(Boolean);
}

// GET /mikrotik/pppoe-profiles
router.get('/pppoe-profiles', limiter, async (req, res) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(401).json({ ok: false, error: 'Missing tenant (x-isp-id)' });

  const serverId = pickServerId(req);
  const timeoutMs = 10000;

  try {
    const rows = await sendCommand('/ppp/profile/print', [], { tenantId, timeoutMs, serverId });
    const profiles = normalizeProfiles(rows);
    return res.json({ ok: true, count: profiles.length, profiles });
  } catch (err) {
    // classify upstream vs internal
    const msg = String(err?.message || err || 'unknown');
    const upstream = /timeout|auth|connect|EHOST|ECONN|network|UNKNOWNREPLY|!empty/i.test(msg);
    console.error('mikrotik/pppoe-profiles error:', msg);
    return res.status(upstream ? 502 : 500).json({ ok: false, profiles: [], error: msg });
  }
});

module.exports = router;
