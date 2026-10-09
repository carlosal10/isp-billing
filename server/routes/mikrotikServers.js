'use strict';
const express = require('express');
const { z } = require('zod');
const Router = require('../models/MikrotikConnection');
const manager = require('../utils/mikrotikConnectionManager');
const requireRole = require('../middleware/requireRole');
const { validRouterHost, connectionDiagnostic } = require('../services/routerConnectionDiagnostics');
const router = express.Router();
const CreateBody = z.object({
  name: z.string().trim().min(1).max(60), host: z.string().trim().refine(validRouterHost),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().trim().min(1).max(128), password: z.string().min(1).max(512),
  tls: z.boolean().optional(), primary: z.boolean().optional(),
  site: z.string().trim().max(120).optional(), tags: z.array(z.string().max(60)).max(20).optional(),
});
function report(res, error) {
  if (error?.code === 11000) return res.status(409).json({ ok: false, error: 'A router with this name or address already exists.' });
  if (['CastError', 'ValidationError'].includes(error?.name)) return res.status(400).json({ ok: false, error: 'Invalid router settings or identifier.' });
  const diagnostic = connectionDiagnostic(error);
  return res.status(502).json({ ok: false, reason: diagnostic.code, error: diagnostic.message });
}
async function verify(tenantId, record) {
  const out = await manager.sendCommand('/system/identity/print', [], { tenantId, serverId: String(record._id), timeoutMs: 12000, retryCount: 1 });
  const identity = Array.isArray(out) ? out[0]?.name : null;
  if (!identity) throw new Error('Router did not return an identity');
  await Router.updateOne({ tenant: tenantId, _id: record._id }, { $set: { lastVerifiedAt: new Date() } });
  return identity;
}
router.get('/', async (req, res) => {
  try {
    const rows = await Router.find({ tenant: req.tenantId }).select('-password -username').sort({ primary: -1, name: 1 }).lean();
    res.json({ ok: true, servers: rows.map(r => ({ id: String(r._id), name: r.name, host: r.host, port: r.port, tls: r.tls,
      primary: r.primary, site: r.site, tags: r.tags, lastVerifiedAt: r.lastVerifiedAt || null })) });
  } catch (error) { report(res, error); }
});
router.post('/', requireRole('owner', 'admin'), async (req, res) => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Enter a valid router name, address and API credentials.' });
  try {
    const body = parsed.data;
    const record = await Router.create({ ...body, port: body.port || (body.tls ? 8729 : 8728),
      tenant: req.tenantId, createdBy: req.user?.sub, updatedBy: req.user?.sub });
    if (body.primary) await Router.updateMany({ tenant: req.tenantId, _id: { $ne: record._id }, primary: true }, { $set: { primary: false } });
    let identity = null, diagnostic = null;
    try { identity = await verify(req.tenantId, record); } catch (error) { diagnostic = connectionDiagnostic(error); }
    return res.status(201).json({ ok: true, id: String(record._id), verified: !!identity, identity, diagnostic });
  } catch (error) { report(res, error); }
});
router.put('/:id', requireRole('owner', 'admin'), async (req, res) => {
  const parsed = CreateBody.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid router settings.' });
  try {
    const existing = await Router.findOne({ _id: req.params.id, tenant: req.tenantId });
    if (!existing) return res.status(404).json({ ok: false, error: 'Router not found.' });
    const update = { ...parsed.data, updatedBy: req.user?.sub };
    if (update.tls !== undefined && update.port === undefined && [8728, 8729].includes(existing.port)) update.port = update.tls ? 8729 : 8728;
    const connectionChanged = ['host', 'port', 'username', 'password', 'tls'].some(key => update[key] !== undefined);
    if (connectionChanged) update.lastVerifiedAt = null;
    const record = await Router.findOneAndUpdate({ _id: existing._id, tenant: req.tenantId }, { $set: update }, { new: true, runValidators: true });
    if (update.primary) await Router.updateMany({ tenant: req.tenantId, _id: { $ne: record._id }, primary: true }, { $set: { primary: false } });
    if (connectionChanged) await manager.invalidate(req.tenantId, record._id);
    if (req.query.verify === 'true') return res.json({ ok: true, verified: true, identity: await verify(req.tenantId, record) });
    res.json({ ok: true });
  } catch (error) { report(res, error); }
});
router.delete('/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const result = await require('../services/financialTransaction').financialTransaction(async () => {
      // Assignment creation writes this same record, preventing a concurrent orphan.
      const record = await Router.findOneAndUpdate({ _id: req.params.id, tenant: req.tenantId }, { $inc: { __v: 1 } });
      if (!record) return { record: null };
      if (await require('../models/NetworkAssignment').exists({ tenantId: req.tenantId, routerId: req.params.id, status: { $ne: 'released' } })) return { blocked: true };
      await Router.deleteOne({ _id: record._id, tenant: req.tenantId });
      return { record };
    });
    if (result.blocked) return res.status(409).json({ error: 'Release subscriber assignments and confirm removal before deleting this router.' });
    const { record } = result;
    if (!record) return res.status(404).json({ ok: false, error: 'Router not found.' });
    await manager.invalidate(req.tenantId, record._id);
    res.json({ ok: true });
  } catch (error) { report(res, error); }
});
router.post('/:id/test', async (req, res) => {
  try {
    // The path identifies the router being tested. A global UI selection cannot override it.
    const record = await Router.findOne({ _id: req.params.id, tenant: req.tenantId });
    if (!record) return res.status(404).json({ ok: false, error: 'Router not found.' });
    res.json({ ok: true, verified: true, identity: await verify(req.tenantId, record) });
  } catch (error) { report(res, error); }
});
module.exports = router;
router.get('/:id/sessions', async (req, res) => {
  try { res.json({ sessions: await require('../services/radiusAccountingService').listSessions(req.tenantId, req.params.id), limit: 100, staleAfterSeconds: 900 }); }
  catch (error) { if (error.statusCode) return res.status(error.statusCode).json({ error: error.message }); report(res, error); }
});
