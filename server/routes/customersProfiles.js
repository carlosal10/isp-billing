// routes/customersProfiles.js
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { sendCommand } = require('../utils/mikrotikConnectionManager');

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

// GET /customers/profiles
router.get('/profiles', limiter, async (req, res) => {
  const tenantId = req.tenantId;
  try {
    const rows = await sendCommand('/ppp/profile/print', [], { tenantId, timeoutMs: 10000 });
    const profiles = normalizeProfiles(rows);
    return res.json({ message: 'Profiles loaded from MikroTik', profiles });
  } catch (err) {
    console.error('customers/profiles error:', err?.message || err);
    // Graceful degrade to avoid breaking UI
    return res.json({
      message: 'No PPPoE profiles available (router not connected or unauthorized)',
      profiles: [],
      error: String(err?.message || err),
    });
  }
});

module.exports = router;
