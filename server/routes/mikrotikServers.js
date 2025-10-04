// routes/mikrotikServers.js
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

// List servers for this tenant
router.get('/', async (req, res) => {
  const tenantId = req.tenantId;
  const rows = await MikroTikConnection.find({ tenant: tenantId }).sort({ primary: -1, name: 1 }).lean();
  res.json(rows.map((r) => ({
    id: String(r._id), name: r.name, host: r.host, port: r.port, tls: !!r.tls, primary: !!r.primary,
    site: r.site || null, tags: r.tags || [], lastVerifiedAt: r.lastVerifiedAt || null,
  })));
});

// Create server
router.post('/', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const parsed = CreateBody.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });
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

    // best-effort connectivity test
    let identity = null;
    try {
      const out = await sendCommand('/system/identity/print', [], { tenantId, serverId: String(doc._id), timeoutMs: 10000 });
      identity = Array.isArray(out) && out[0]?.name || null;
      await MikroTikConnection.updateOne({ _id: doc._id }, { $set: { lastVerifiedAt: new Date() } });
    } catch {}

    res.status(201).json({ ok: true, id: String(doc._id), identity });
  } catch (e) {
    const msg = e?.message || 'Create failed';
    const dup = e?.code === 11000;
    return res.status(dup ? 409 : 500).json({ error: msg });
  }
});

// Update server
router.put('/:id', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const id = req.params.id;
    const parsed = UpdateBody.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });
    const body = parsed.data;

    const update = {};
    for (const k of ['name','host','username','password','site']) if (body[k] !== undefined) update[k] = String(body[k]).trim();
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
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    const msg = e?.message || 'Update failed';
    const dup = e?.code === 11000;
    return res.status(dup ? 409 : 500).json({ error: msg });
  }
});

// Delete server
router.delete('/:id', async (req, res) => {
  const tenantId = req.tenantId;
  const id = req.params.id;
  const doc = await MikroTikConnection.findOneAndDelete({ _id: id, tenant: tenantId });
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// Test server
router.post('/:id/test', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const id = req.params.id;
    const out = await sendCommand('/system/identity/print', [], { tenantId, serverId: id, timeoutMs: 10000 });
    const identity = Array.isArray(out) && out[0]?.name || null;
    await MikroTikConnection.updateOne({ _id: id, tenant: tenantId }, { $set: { lastVerifiedAt: new Date() } });
    res.json({ ok: true, identity });
  } catch (e) {
    const msg = e?.message || 'Test failed';
    const upstream = /timeout|auth|connect|EHOST|ECONN|network/i.test(msg);
    res.status(upstream ? 502 : 500).json({ error: msg });
  }
});

module.exports = router;

