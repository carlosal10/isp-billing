// routes/arp.js
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { sendCommand } = require('../utils/mikrotikConnectionManager');

const limiter = rateLimit({ windowMs: 5000, max: 20, standardHeaders: true });
const isPrivate = ip => { const o = ip.split('.').map(Number); return o[0]===10 || (o[0]===172 && o[1]>=16 && o[1]<=31) || (o[0]===192 && o[1]===168); };

router.get('/', limiter, async (req, res) => {
  const tenantId = req.tenantId, timeoutMs = 10000;
  const lanOnly = req.query.lanOnly === 'true';
  const privateOnly = req.query.privateOnly === 'true';
  const permanentOnly = req.query.permanentOnly === 'true';
  try {
    const serverId = req.headers['x-isp-server'] || req.query.serverId || null;
    const [arps, bridges, vlans] = await Promise.all([
      sendCommand('/ip/arp/print', [], { tenantId, timeoutMs, serverId }).catch(() => []),
      sendCommand('/interface/bridge/print', [], { tenantId, timeoutMs, serverId }).catch(() => []),
      sendCommand('/interface/vlan/print', [], { tenantId, timeoutMs, serverId }).catch(() => []),
    ]);
    const lanIf = new Set([
      ...((bridges||[]).map(b => String(b?.name||'').trim()).filter(Boolean)),
      ...((vlans||[]).map(v => String(v?.name || v?.interface || '').trim()).filter(Boolean)),
    ]);
    const out = [];
    for (const a of (Array.isArray(arps) ? arps : [])) {
      const address = String(a?.address || '').trim();
      if (!address) continue;
      if (privateOnly && !isPrivate(address)) continue;
      const iface = String(a?.interface || '').trim();
      if (lanOnly && iface && !lanIf.has(iface)) continue;
      const isDyn = String(a?.dynamic || 'no') === 'yes';
      const type = String(a?.type || '').toLowerCase();
      const permanent = !isDyn || type === 'static';
      if (permanentOnly && !permanent) continue;
      out.push({ address, interface: iface || null, comment: String(a?.comment || a?.['mac-address'] || '').trim() });
    }
    res.json({ ok: true, arps: out });
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'arp failed' });
  }
});
module.exports = router;
