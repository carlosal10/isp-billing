// routes/staticControl.js
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');

const { sendCommand } = require('../utils/mikrotikConnectionManager');
const DiscoverSnapshot = require('../models/DiscoverSnapshot');
const AuditLog = require('../models/AuditLog');

const limiter = rateLimit({ windowMs: 5000, max: 20, standardHeaders: true });

// ---- Helpers ----
const qs = (k, v) => `?${k}=${v}`;
const w = (k, v) => `=${k}=${v}`;
const idOf = (r) => r?.['.id'] ?? r?.id ?? r?.numbers ?? null;

const COMMENTS = {
  EST_REL: 'EST/REL (billing)',
  MONITOR: (seg) => `MONITOR unknown on ${seg}`,
  ALLOW: 'Allow paid static IPs',
  BLOCK: 'Block unpaid static IPs',
  DROP_UNKNOWN: (seg) => `Drop unknown on ${seg}`,
};

function isPrivateIPv4(ip) {
  try {
    const o = ip.split('.').map(Number);
    if (o.length !== 4 || o.some((x) => x < 0 || x > 255)) return false;
    if (o[0] === 10) return true;
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
    if (o[0] === 192 && o[1] === 168) return true;
    return false;
  } catch {
    return false;
  }
}

async function audit(req, action, payload) {
  try {
    await AuditLog.create({ tenantId: req.tenantId, actor: req.user?.sub || null, action, routerHost: null, payload });
  } catch {}
}

// ---- Phase A: Detect (read-only) ----
router.get('/detect', limiter, async (req, res) => {
  const tenantId = req.tenantId;
  const timeoutMs = 12000;
  try {
    const [bridges, vlans, ipAddrs, dhcpServers, dhcpLeases, filters, lists, arps, queues, pppActive, pppServer] = await Promise.all([
      sendCommand('/interface/bridge/print', [], { tenantId, timeoutMs }).catch(() => []),
      sendCommand('/interface/vlan/print', [], { tenantId, timeoutMs }).catch(() => []),
      sendCommand('/ip/address/print', [], { tenantId, timeoutMs }).catch(() => []),
      sendCommand('/ip/dhcp-server/print', [], { tenantId, timeoutMs }).catch(() => []),
      sendCommand('/ip/dhcp-server/lease/print', [], { tenantId, timeoutMs }).catch(() => []),
      sendCommand('/ip/firewall/filter/print', [], { tenantId, timeoutMs }).catch(() => []),
      sendCommand('/ip/firewall/address-list/print', [], { tenantId, timeoutMs }).catch(() => []),
      sendCommand('/ip/arp/print', [], { tenantId, timeoutMs }).catch(() => []),
      sendCommand('/queue/simple/print', [], { tenantId, timeoutMs }).catch(() => []),
      sendCommand('/ppp/active/print', [], { tenantId, timeoutMs }).catch(() => []),
      sendCommand('/interface/pppoe-server/print', [], { tenantId, timeoutMs }).catch(() => []),
    ]);

    const segs = [];
    for (const b of Array.isArray(bridges) ? bridges : []) {
      const name = String(b?.name || 'bridge');
      const addr = (ipAddrs.find((x) => x?.interface === name)?.address || '').split('/')[0] || '';
      segs.push({ name, type: 'bridge', lanCidr: (ipAddrs.find((x) => x?.interface === name)?.address || '') || null });
      if (addr && !isPrivateIPv4(addr)) {
        // public subnet on LAN — warn
      }
    }
    for (const v of Array.isArray(vlans) ? vlans : []) {
      const name = String(v?.name || v?.interface || 'vlan');
      const addr = (ipAddrs.find((x) => x?.interface === name)?.address || '').split('/')[0] || '';
      segs.push({ name, type: 'vlan', lanCidr: (ipAddrs.find((x) => x?.interface === name)?.address || '') || null });
      if (addr && !isPrivateIPv4(addr)) {
        // public subnet on LAN — warn
      }
    }

    const listsByName = lists.reduce((acc, r) => {
      const list = String(r?.list || '').trim();
      if (!list) return acc;
      if (!acc[list]) acc[list] = [];
      acc[list].push({ address: r?.address, comment: r?.comment, id: idOf(r) });
      return acc;
    }, {});

    const filtersNorm = filters.map((f, idx) => ({ id: idOf(f), idx, chain: f?.chain, action: f?.action, comment: f?.comment }));

    const arpBindings = (Array.isArray(arps) ? arps : []).map((x) => ({
      interface: x?.interface || null,
      address: x?.address || null,
      mac: x?.['mac-address'] || null,
      permanent: String(x?.['type'] || '').toLowerCase() === 'static' || String(x?.dynamic || 'no') === 'no',
      comment: x?.comment || null,
    }));

    const simpleQueues = (Array.isArray(queues) ? queues : []).map((q) => ({
      name: String(q?.name || ''),
      target: String(q?.target || ''),
      comment: q?.comment || '',
      maxLimit: q?.['max-limit'] || q?.maxLimit || '',
    }));

    const notes = [];
    for (const s of segs) {
      const ip = (s.lanCidr || '').split('/')[0];
      if (ip && !isPrivateIPv4(ip)) notes.push({ kind: 'public-lan-warning', segment: s.name, ipCidr: s.lanCidr });
    }

    const snapshot = {
      segments: segs,
      dhcpServers: (Array.isArray(dhcpServers) ? dhcpServers : []).map((d) => ({ name: d?.name, interface: d?.interface, disabled: String(d?.disabled || 'no') === 'yes' })),
      lists: {
        STATIC_ALLOW: listsByName['STATIC_ALLOW'] || [],
        STATIC_BLOCK: listsByName['STATIC_BLOCK'] || [],
        UNKNOWN_SOURCES: listsByName['UNKNOWN_SOURCES'] || [],
      },
      filters: filtersNorm,
      arpBindings,
      simpleQueues,
      pppoe: {
        serverConfigs: Array.isArray(pppServer) ? pppServer : [],
        active: Array.isArray(pppActive) ? pppActive : [],
      },
      notes,
    };

    // store for audit/rollback
    try { await DiscoverSnapshot.create({ tenantId, payload: snapshot }); } catch {}
    return res.json({ ok: true, snapshot });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'Detect failed' });
  }
});

// Ensure address lists exist
async function ensureList(tenantId, list, timeoutMs) {
  const rows = await sendCommand('/ip/firewall/address-list/print', [qs('list', list)], { tenantId, timeoutMs });
  if (Array.isArray(rows) && rows.length > 0) return idOf(rows[0]);
  const add = await sendCommand('/ip/firewall/address-list/add', [w('list', list), w('comment', list === 'STATIC_ALLOW' ? 'Billing: allowed static' : list === 'STATIC_BLOCK' ? 'Billing: blocked static' : 'Billing: learned unknowns (monitor)')], { tenantId, timeoutMs });
  return (Array.isArray(add) && add[0] && idOf(add[0])) || true;
}

async function findRuleByComment(tenantId, comment, timeoutMs) {
  const rows = await sendCommand('/ip/firewall/filter/print', [qs('comment', comment)], { tenantId, timeoutMs });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

// ---- Phase B: Bootstrap monitor-mode (idempotent) ----
router.post('/bootstrap', limiter, async (req, res) => {
  const tenantId = req.tenantId;
  const timeoutMs = 12000;
  const { segment = 'bridge', dryRun = false } = req.body || {};
  const toCreate = { lists: [], rules: [] };
  try {
    // lists
    for (const L of ['STATIC_ALLOW', 'STATIC_BLOCK', 'UNKNOWN_SOURCES']) {
      const existing = await sendCommand('/ip/firewall/address-list/print', [qs('list', L)], { tenantId, timeoutMs }).catch(() => []);
      if (!Array.isArray(existing) || existing.length === 0) toCreate.lists.push(L);
    }

    // rules by stable comment
    const need = [];
    const est = await findRuleByComment(tenantId, COMMENTS.EST_REL, timeoutMs);
    if (!est) need.push({ comment: COMMENTS.EST_REL, addWords: [w('chain', 'forward'), w('connection-state', 'established,related'), w('action', 'accept'), w('comment', COMMENTS.EST_REL)] });

    const monC = COMMENTS.MONITOR(segment);
    const mon = await findRuleByComment(tenantId, monC, timeoutMs);
    if (!mon) need.push({ comment: monC, addWords: [w('chain', 'forward'), w('in-interface', segment), w('src-address-list', '!STATIC_ALLOW'), w('action', 'add-src-to-address-list'), w('address-list', 'UNKNOWN_SOURCES'), w('address-list-timeout', '1h'), w('comment', monC)] });

    const allow = await findRuleByComment(tenantId, COMMENTS.ALLOW, timeoutMs);
    if (!allow) need.push({ comment: COMMENTS.ALLOW, addWords: [w('chain', 'forward'), w('src-address-list', 'STATIC_ALLOW'), w('action', 'accept'), w('disabled', 'yes'), w('comment', COMMENTS.ALLOW)] });

    const block = await findRuleByComment(tenantId, COMMENTS.BLOCK, timeoutMs);
    if (!block) need.push({ comment: COMMENTS.BLOCK, addWords: [w('chain', 'forward'), w('src-address-list', 'STATIC_BLOCK'), w('action', 'drop'), w('disabled', 'yes'), w('comment', COMMENTS.BLOCK)] });

    const dropC = COMMENTS.DROP_UNKNOWN(segment);
    const dropU = await findRuleByComment(tenantId, dropC, timeoutMs);
    if (!dropU) need.push({ comment: dropC, addWords: [w('chain', 'forward'), w('in-interface', segment), w('action', 'drop'), w('disabled', 'yes'), w('comment', dropC)] });

    toCreate.rules = need.map((n) => n.comment);
    if (dryRun) {
      return res.json({ ok: true, dryRun: true, toCreate });
    }

    // create lists
    for (const L of toCreate.lists) await ensureList(tenantId, L, timeoutMs);
    // add rules
    const created = [];
    for (const spec of need) {
      const r = await sendCommand('/ip/firewall/filter/add', spec.addWords, { tenantId, timeoutMs });
      created.push({ comment: spec.comment, id: (Array.isArray(r) && r[0] && idOf(r[0])) || true });
    }

    await audit(req, 'static.bootstrap', { segment, listsCreated: toCreate.lists, rulesCreated: created });
    return res.json({ ok: true, listsCreated: toCreate.lists, rulesCreated: created });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'Bootstrap failed' });
  }
});

// ---- Phase C: Seed STATIC_ALLOW from queues and ARP (idempotent, no drops) ----
router.post('/seed-allow', limiter, async (req, res) => {
  const tenantId = req.tenantId;
  const timeoutMs = 12000;
  const { include = ['queues', 'arp'] } = req.body || {};
  try {
    const queues = include.includes('queues') ? await sendCommand('/queue/simple/print', [], { tenantId, timeoutMs }).catch(() => []) : [];
    const arps = include.includes('arp') ? await sendCommand('/ip/arp/print', [], { tenantId, timeoutMs }).catch(() => []) : [];

    const ipSet = new Map();
    function firstIpFromTarget(t) {
      if (!t) return null;
      const first = String(t).split(',')[0].trim();
      const ip = first.split('/')[0].trim();
      return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) ? ip : null;
    }
    for (const q of queues || []) {
      const ip = firstIpFromTarget(q?.target);
      if (!ip) continue;
      const label = String(q?.name || '').trim();
      if (!ipSet.has(ip)) ipSet.set(ip, { source: 'queue', comment: label ? `import-queue:${label}` : 'import-queue' });
    }
    for (const a of arps || []) {
      const ip = String(a?.address || '').trim();
      if (!ip) continue;
      const isDyn = String(a?.dynamic || 'no') === 'yes';
      const type = String(a?.type || '').toLowerCase();
      const permanent = !isDyn || type === 'static';
      if (!permanent) continue; // only whitelisted ARP entries
      const label = String(a?.comment || a?.['mac-address'] || '').trim();
      if (!ipSet.has(ip)) ipSet.set(ip, { source: 'arp', comment: label ? `import-arp:${label}` : 'import-arp' });
    }

    // Ensure STATIC_ALLOW list exists
    await ensureList(tenantId, 'STATIC_ALLOW', timeoutMs);

    // Add if missing
    const added = [];
    for (const [ip, meta] of ipSet.entries()) {
      const exists = await sendCommand('/ip/firewall/address-list/print', [qs('list', 'STATIC_ALLOW'), qs('address', ip)], { tenantId, timeoutMs }).catch(() => []);
      if (Array.isArray(exists) && exists.length) continue;
      const words = [w('list', 'STATIC_ALLOW'), w('address', ip)];
      if (meta.comment) words.push(w('comment', meta.comment));
      const r = await sendCommand('/ip/firewall/address-list/add', words, { tenantId, timeoutMs });
      added.push({ ip, id: (Array.isArray(r) && r[0] && idOf(r[0])) || true, source: meta.source });
    }

    await audit(req, 'static.seed-allow', { addedCount: added.length });
    return res.json({ ok: true, addedCount: added.length, added });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'Seed failed' });
  }
});

// ---- Phase D: Observe UNKNOWN_SOURCES and heuristics ----
router.get('/unknown-sources', limiter, async (req, res) => {
  const tenantId = req.tenantId;
  const timeoutMs = 10000;
  try {
    const unknown = await sendCommand('/ip/firewall/address-list/print', [qs('list', 'UNKNOWN_SOURCES')], { tenantId, timeoutMs }).catch(() => []);
    const out = [];
    for (const r of unknown || []) {
      const ip = String(r?.address || '').trim();
      if (!ip) continue;
      const [queue, arp, lease] = await Promise.all([
        sendCommand('/queue/simple/print', [qs('target', ip)], { tenantId, timeoutMs }).catch(() => []),
        sendCommand('/ip/arp/print', [qs('address', ip)], { tenantId, timeoutMs }).catch(() => []),
        sendCommand('/ip/dhcp-server/lease/print', [qs('address', ip)], { tenantId, timeoutMs }).catch(() => []),
      ]);
      const hasQueue = Array.isArray(queue) && queue.length > 0;
      const arpRow = Array.isArray(arp) && arp[0] ? arp[0] : null;
      const inArpPermanent = arpRow ? (String(arpRow.dynamic || 'no') === 'no' || String(arpRow.type || '').toLowerCase() === 'static') : false;
      const hasDhcpLease = Array.isArray(lease) && lease.length > 0;
      out.push({ address: ip, comment: r?.comment || '', hasQueue, inArpPermanent, hasDhcpLease, segment: arpRow?.interface || null });
    }
    return res.json({ ok: true, items: out });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'List unknown failed' });
  }
});

// ---- Phase E: Enable enforcement (order + enable) ----
async function listFilterRules(tenantId, timeoutMs) {
  const rows = await sendCommand('/ip/firewall/filter/print', [], { tenantId, timeoutMs });
  return (Array.isArray(rows) ? rows : []).map((r, i) => ({ id: idOf(r), idx: i, comment: r?.comment || '', chain: r?.chain || '', action: r?.action || '' }));
}

async function moveBefore(tenantId, numbersId, destinationId, timeoutMs) {
  if (!numbersId || !destinationId) return;
  await sendCommand('/ip/firewall/filter/move', [w('numbers', numbersId), w('destination', destinationId)], { tenantId, timeoutMs });
}

router.post('/enforce', limiter, async (req, res) => {
  const tenantId = req.tenantId;
  const timeoutMs = 12000;
  const { segment = 'bridge' } = req.body || {};
  try {
    // Ensure rules exist (idempotent with bootstrap)
    const est = await findRuleByComment(tenantId, COMMENTS.EST_REL, timeoutMs) || (await sendCommand('/ip/firewall/filter/add', [w('chain', 'forward'), w('connection-state', 'established,related'), w('action', 'accept'), w('comment', COMMENTS.EST_REL)], { tenantId, timeoutMs }));
    const allow = await findRuleByComment(tenantId, COMMENTS.ALLOW, timeoutMs) || (await sendCommand('/ip/firewall/filter/add', [w('chain', 'forward'), w('src-address-list', 'STATIC_ALLOW'), w('action', 'accept'), w('disabled', 'yes'), w('comment', COMMENTS.ALLOW)], { tenantId, timeoutMs }));
    const block = await findRuleByComment(tenantId, COMMENTS.BLOCK, timeoutMs) || (await sendCommand('/ip/firewall/filter/add', [w('chain', 'forward'), w('src-address-list', 'STATIC_BLOCK'), w('action', 'drop'), w('disabled', 'yes'), w('comment', COMMENTS.BLOCK)], { tenantId, timeoutMs }));
    const drop = await findRuleByComment(tenantId, COMMENTS.DROP_UNKNOWN(segment), timeoutMs) || (await sendCommand('/ip/firewall/filter/add', [w('chain', 'forward'), w('in-interface', segment), w('action', 'drop'), w('disabled', 'yes'), w('comment', COMMENTS.DROP_UNKNOWN(segment))], { tenantId, timeoutMs }));

    const ids = {
      est: Array.isArray(est) ? idOf(est[0]) : idOf(est),
      allow: Array.isArray(allow) ? idOf(allow[0]) : idOf(allow),
      block: Array.isArray(block) ? idOf(block[0]) : idOf(block),
      drop: Array.isArray(drop) ? idOf(drop[0]) : idOf(drop),
    };

    // Reorder deterministically: EST -> ALLOW -> BLOCK -> DROP
    // We move items by placing them before the item that currently starts the chain segment.
    let rules = await listFilterRules(tenantId, timeoutMs);
    const order = [ids.est, ids.allow, ids.block, ids.drop].filter(Boolean);
    for (let i = 0; i < order.length; i++) {
      const wantId = order[i];
      rules = await listFilterRules(tenantId, timeoutMs);
      const idxs = new Map(rules.map((r, i2) => [r.id, i2]));
      const firstId = rules[0]?.id;
      if (i === 0) {
        if (idxs.get(wantId) !== 0) await moveBefore(tenantId, wantId, firstId, timeoutMs);
      } else {
        const prevId = order[i - 1];
        rules = await listFilterRules(tenantId, timeoutMs);
        const afterPrevIdx = rules.findIndex((r) => r.id === prevId) + 1;
        const destId = rules[afterPrevIdx]?.id || null; // move before what comes after prev
        if (destId && destId !== wantId) await moveBefore(tenantId, wantId, destId, timeoutMs);
      }
    }

    // Enable three rules
    await sendCommand('/ip/firewall/filter/set', [w('numbers', ids.allow), w('disabled', 'no')], { tenantId, timeoutMs }).catch(() => {});
    await sendCommand('/ip/firewall/filter/set', [w('numbers', ids.block), w('disabled', 'no')], { tenantId, timeoutMs }).catch(() => {});
    await sendCommand('/ip/firewall/filter/set', [w('numbers', ids.drop), w('disabled', 'no')], { tenantId, timeoutMs }).catch(() => {});

    await audit(req, 'static.enforce', { segment, ruleIds: ids });
    return res.json({ ok: true, enabled: ['allow', 'block', 'drop'], ruleIds: ids });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'Enforce failed' });
  }
});

// ---- Adopt helper: add to STATIC_ALLOW (optionally create queue) ----
router.post('/adopt', limiter, async (req, res) => {
  const tenantId = req.tenantId;
  const timeoutMs = 10000;
  const { ip, comment = 'adopted', createQueue = false, rateLimit = '' } = req.body || {};
  try {
    if (!ip) return res.status(400).json({ ok: false, error: 'ip required' });
    await ensureList(tenantId, 'STATIC_ALLOW', timeoutMs);
    const exists = await sendCommand('/ip/firewall/address-list/print', [qs('list', 'STATIC_ALLOW'), qs('address', ip)], { tenantId, timeoutMs });
    if (!Array.isArray(exists) || exists.length === 0) {
      await sendCommand('/ip/firewall/address-list/add', [w('list', 'STATIC_ALLOW'), w('address', ip), w('comment', comment)], { tenantId, timeoutMs });
    }
    if (createQueue) {
      const q = await sendCommand('/queue/simple/print', [qs('target', ip)], { tenantId, timeoutMs });
      if (!Array.isArray(q) || q.length === 0) {
        const target = `${ip}/32`;
        const words = [w('name', `cust:${ip}`), w('target', target)];
        if (rateLimit) words.push(w('max-limit', rateLimit));
        await sendCommand('/queue/simple/add', words, { tenantId, timeoutMs });
      }
    }
    await audit(req, 'static.adopt', { ip, createQueue, rateLimit });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'Adopt failed' });
  }
});

module.exports = router;
