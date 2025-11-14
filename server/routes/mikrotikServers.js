// routes/mikrotikServers.js
// CRUD + test endpoints for tenant MikroTik servers.
// Improvements:
// - consistent tenant checks + error shapes
// - honor per-request server selector (headers / ?serverId)
// - defensive DB operations and error classification
// - best-effort connectivity test after create/update

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const MikroTikConnection = require('../models/MikrotikConnection');
const { sendCommand } = require('../utils/mikrotikConnectionManager');

const CreateBody = z.object({
  name: z.string().min(1).max(60),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().min(1),
  password: z.string().min(1),
  tls: z.boolean().optional(),
  primary: z.boolean().optional(),
  site: z.string().max(120).optional(),
  tags: z.array(z.string()).optional(),
});
const UpdateBody = CreateBody.partial();

// helper: pick server id override from headers/query
function pickServerId(req) {
  return (
    req.headers['x-isp-server'] ||
    req.headers['x-router-id'] ||
    req.query?.serverId ||
    req.query?.server ||
    null
  );
}

// GET / - list servers for this tenant
router.get('/', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ ok: false, error: 'Missing tenant (x-isp-id)' });

    const rows = await MikroTikConnection.find({ tenant: tenantId })
      .sort({ primary: -1, name: 1 })
      .lean();

    const out = (rows || []).map((r) => ({
      id: String(r._id),
      name: r.name,
      host: r.host,
      port: r.port,
      tls: !!r.tls,
      primary: !!r.primary,
      site: r.site || null,
      tags: r.tags || [],
      lastVerifiedAt: r.lastVerifiedAt || null,
    }));

    return res.json({ ok: true, count: out.length, servers: out });
  } catch (e) {
    console.error('mikrotikServers.list error:', e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || 'List failed' });
  }
});

// POST / - create server
router.post('/', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ ok: false, error: 'Missing tenant (x-isp-id)' });

    const parsed = CreateBody.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid payload', details: parsed.error.format() });
    const body = parsed.data;

    if (body.primary === true) {
      await MikroTikConnection.updateMany({ tenant: tenantId, primary: true }, { $set: { primary: false } });
    }

    const doc = await MikroTikConnection.create({
      tenant: tenantId,
      name: body.name.trim(),
      host: String(body.host).trim(),
      port: Number(body.port || (body.tls ? 8729 : 8728)),
      username: body.username.trim(),
      password: String(body.password),
      tls: !!body.tls,
      primary: !!body.primary,
      site: body.site || undefined,
      tags: body.tags || [],
      createdBy: req.user?.sub || null,
      updatedBy: req.user?.sub || null,
    });

    // best-effort connectivity test (serverId override irrelevant here)
    let identity = null;
    try {
      const out = await sendCommand('/system/identity/print', [], { tenantId, serverId: String(doc._id), timeoutMs: 10000 });
      identity = Array.isArray(out) && out[0]?.name || null;
      await MikroTikConnection.updateOne({ _id: doc._id }, { $set: { lastVerifiedAt: new Date() } });
    } catch (connectErr) {
      // ignore test failure (record still created); return identity null and log
      console.warn('mikrotikServers.create test failed:', connectErr?.message || connectErr);
    }

    return res.status(201).json({ ok: true, id: String(doc._id), identity });
  } catch (e) {
    console.error('mikrotikServers.create error:', e?.message || e);
    const dup = e?.code === 11000;
    return res.status(dup ? 409 : 500).json({ ok: false, error: e?.message || 'Create failed' });
  }
});

// PUT /:id - update server
router.put('/:id', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ ok: false, error: 'Missing tenant (x-isp-id)' });

    const id = String(req.params.id || '');
    if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

    const parsed = UpdateBody.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid payload', details: parsed.error.format() });
    const body = parsed.data;

    const update = {};
    for (const k of ['name', 'host', 'username', 'password', 'site']) {
      if (body[k] !== undefined) update[k] = String(body[k]).trim();
    }
    if (body.port !== undefined) update.port = Number(body.port);
    if (body.tls !== undefined) update.tls = !!body.tls;
    if (Array.isArray(body.tags)) update.tags = body.tags;
    if (body.primary === true) {
      await MikroTikConnection.updateMany({ tenant: tenantId, primary: true }, { $set: { primary: false } });
      update.primary = true;
    } else if (body.primary === false) {
      update.primary = false;
    }
    update.updatedBy = req.user?.sub || null;

    const doc = await MikroTikConnection.findOneAndUpdate({ _id: id, tenant: tenantId }, { $set: update }, { new: true });
    if (!doc) return res.status(404).json({ ok: false, error: 'Not found' });

    // optional connectivity test if caller provides ?verify=true
    if (String(req.query?.verify || 'false').toLowerCase() === 'true') {
      try {
        const out = await sendCommand('/system/identity/print', [], { tenantId, serverId: pickServerId(req) || id, timeoutMs: 10000 });
        const identity = Array.isArray(out) && out[0]?.name || null;
        await MikroTikConnection.updateOne({ _id: doc._id }, { $set: { lastVerifiedAt: new Date() } });
        return res.json({ ok: true, identity });
      } catch (verifyErr) {
        console.warn('mikrotikServers.update verify failed:', verifyErr?.message || verifyErr);
        const upstream = /timeout|auth|connect|EHOST|ECONN|network/i.test(String(verifyErr?.message || verifyErr));
        return res.status(upstream ? 502 : 500).json({ ok: false, error: verifyErr?.message || 'Verify failed' });
      }
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('mikrotikServers.update error:', e?.message || e);
    const dup = e?.code === 11000;
    return res.status(dup ? 409 : 500).json({ ok: false, error: e?.message || 'Update failed' });
  }
});

// DELETE /:id - delete server
router.delete('/:id', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ ok: false, error: 'Missing tenant (x-isp-id)' });

    const id = String(req.params.id || '');
    if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

    const doc = await MikroTikConnection.findOneAndDelete({ _id: id, tenant: tenantId });
    if (!doc) return res.status(404).json({ ok: false, error: 'Not found' });

    return res.json({ ok: true });
  } catch (e) {
    console.error('mikrotikServers.delete error:', e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || 'Delete failed' });
  }
});

// POST /:id/test - test server connectivity
router.post('/:id/test', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ ok: false, error: 'Missing tenant (x-isp-id)' });

    const id = String(req.params.id || '');
    if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

    // allow header/query override of server selector, fallback to id
    const serverId = pickServerId(req) || id;

    const out = await sendCommand('/system/identity/print', [], { tenantId, serverId, timeoutMs: 10000 });
    const identity = Array.isArray(out) && out[0]?.name || null;

    try {
      await MikroTikConnection.updateOne({ _id: id, tenant: tenantId }, { $set: { lastVerifiedAt: new Date() } });
    } catch (uErr) {
      // ignore update errors
    }

    return res.json({ ok: true, identity });
  } catch (e) {
    console.error('mikrotikServers.test error:', e?.message || e);
    const msg = e?.message || 'Test failed';
    const upstream = /timeout|auth|connect|EHOST|ECONN|network/i.test(String(msg));
    return res.status(upstream ? 502 : 500).json({ ok: false, error: msg });
  }
});

module.exports = router;
