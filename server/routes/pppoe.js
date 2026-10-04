// routes/pppoe.js
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const service = require('../services/pppoeService');
const { pickServerId } = require('../services/mikrotikSupport');
const { connectionDiagnostic } = require('../services/routerConnectionDiagnostics');

const limiter = rateLimit({ windowMs: 5000, max: 20, standardHeaders: true });

function normalizeProfiles(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : (Array.isArray(raw.profiles) ? raw.profiles : []);
  return arr.map((p, i) => {
    if (!p) return null;
    const id = String(p['.id'] ?? p.id ?? i);
    const name = String(
      p.name ?? p.profile ?? p.profileName ?? p.title ?? p.id ?? p._id ?? p['.id'] ?? `profile_${i}`
    );
    const localAddress = p['local-address'] ?? p.localAddress ?? null;
    const rateLimit = p['rate-limit'] ?? p.rateLimit ?? '';
    return { id, name, localAddress, rateLimit };
  }).filter(Boolean);
}

// GET /pppoe/profiles  (same shape your UI expects)
router.get('/profiles', limiter, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const profiles = await service.profiles({ tenantId, serverId: pickServerId(req) });
    return res.json({ profiles });
  } catch (err) {
    console.error('pppoe/profiles error:', err?.message || err);
    return res.status(502).json({ profiles: [], error: connectionDiagnostic(err).message });
  }
});

module.exports = router;
