// routes/queues.js
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { sendCommand } = require('../utils/mikrotikConnectionManager');

const limiter = rateLimit({ windowMs: 5000, max: 20, standardHeaders: true });
const ipOnly = s => s.split('/')[0].trim();

router.get('/simple', limiter, async (req, res) => {
  const tenantId = req.tenantId, timeoutMs = 10000;
  try {
    const rows = await sendCommand('/queue/simple/print', [], { tenantId, timeoutMs }).catch(() => []);
    const out = [];
    for (const r of (Array.isArray(rows) ? rows : [])) {
      const name = String(r?.name || '').trim();
      const comment = String(r?.comment || '').trim();
      const targets = String(r?.target ?? r?.['target-addresses'] ?? '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(ipOnly)
        .filter(ip => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip));
      for (const ip of targets) out.push({ ip, name, comment });
    }
    res.json({ ok: true, queues: out });
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'queues failed' });
  }
});
module.exports = router;
