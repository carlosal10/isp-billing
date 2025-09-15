// routes/staticCandidates.js
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { sendCommand } = require('../utils/mikrotikConnectionManager');

const limiter = rateLimit({ windowMs: 5000, max: 20, standardHeaders: true });
const isPrivate = ip => { const o = ip.split('.').map(Number); return o[0]===10 || (o[0]===172 && o[1]>=16 && o[1]<=31) || (o[0]===192 && o[1]===168); };

router.get('/', limiter, async (req, res) => {
  const tenantId = req.tenantId, timeoutMs = 10000;
  const include = String(req.query.include || 'queues,lists,arp').split(',').map(s => s.trim());
  const trustLists = req.query.trustLists !== 'false';
  const lanOnly = req.query.lanOnly === 'true';
  const privateOnly = req.query.privateOnly === 'true';
  const permanentOnly = req.query.permanentOnly === 'true';
  try {
    const [queues, lists, arps, bridges, vlans] = await Promise.all([
      include.includes('queues') ? sendCommand('/queue/simple/print', [], { tenantId, timeoutMs }).catch(()=>[]) : [],
      include.includes('lists')  ? sendCommand('/ip/firewall/address-list/print', [], { tenantId, timeoutMs }).catch(()=>[]) : [],
      include.includes('arp')    ? sendCommand('/ip/arp/print', [], { tenantId, timeoutMs }).catch(()=>[]) : [],
      sendCommand('/interface/bridge/print', [], { tenantId, timeoutMs }).catch(()=>[]),
      sendCommand('/interface/vlan/print', [], { tenantId, timeoutMs }).catch(()=>[]),
    ]);
    const lanIf = new Set([
      ...((bridges||[]).map(b => String(b?.name||'').trim()).filter(Boolean)),
      ...((vlans||[]).map(v => String(v?.name || v?.interface || '').trim()).filter(Boolean)),
    ]);

    const map = new Map();

    // queues
    for (const q of (queues||[])) {
      const targets = String(q?.target ?? q?.['target-addresses'] ?? '')
        .split(',').map(s => s.trim()).filter(Boolean)
        .map(s => s.split('/')[0].trim()).filter(ip => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip));
      for (const ip of targets) {
        if (privateOnly && !isPrivate(ip)) continue;
        const prev = map.get(ip) || { ip, label: '', sources: [] };
        prev.sources.push('queue');
        if (!prev.label) prev.label = String(q?.comment || q?.name || '').trim();
        map.set(ip, prev);
      }
    }

    // lists
    if (trustLists) {
      for (const r of (lists||[])) {
        const L = String(r?.list || '');
        if (L !== 'STATIC_ALLOW' && L !== 'UNKNOWN_SOURCES') continue;
        const ip = String(r?.address || '').trim();
        if (!ip) continue;
        if (privateOnly && !isPrivate(ip)) continue;
        const prev = map.get(ip) || { ip, label: '', sources: [] };
        prev.sources.push(`list:${L}`);
        if (!prev.label) prev.label = String(r?.comment || '');
        map.set(ip, prev);
      }
    }

    // arp
    for (const a of (arps||[])) {
      const ip = String(a?.address || '').trim();
      if (!ip) continue;
      if (privateOnly && !isPrivate(ip)) continue;
      const iface = String(a?.interface || '').trim();
      if (lanOnly && iface && !lanIf.has(iface)) continue;
      const isDyn = String(a?.dynamic || 'no') === 'yes';
      const type = String(a?.type || '').toLowerCase();
      const permanent = !isDyn || type === 'static';
      if (permanentOnly && !permanent) continue;
      const prev = map.get(ip) || { ip, label: '', sources: [] };
      prev.sources.push('arp');
      if (!prev.label) prev.label = String(a?.comment || a?.['mac-address'] || iface || '');
      map.set(ip, prev);
    }

    res.json({ ok: true, candidates: Array.from(map.values()) });
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'candidates failed' });
  }
});
module.exports = router;
