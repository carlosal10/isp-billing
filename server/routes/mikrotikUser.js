'use strict';
const express = require('express');
const { z } = require('zod');
const requireRole = require('../middleware/requireRole');
const service = require('../services/pppoeService');
const { pickServerId } = require('../services/mikrotikSupport');
const { connectionDiagnostic } = require('../services/routerConnectionDiagnostics');
const AuditLog = require('../models/AuditLog');
const router = express.Router();
const username = z.string().trim().min(1).max(128).regex(/^[^\x00-\x1f\x7f]+$/);
const password = z.string().min(1).max(256).regex(/^[^\x00-\x1f\x7f]+$/);
const context = req => ({ tenantId: req.tenantId, serverId: pickServerId(req) });
function endpoint(action) {
  return async (req, res) => {
    try { await action(req, res); }
    catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: 'Enter valid PPPoE credentials and a profile.' });
      const diagnostic = connectionDiagnostic(error);
      return res.status(error.statusCode || 502).json({ error: error.statusCode ? error.message : diagnostic.message,
        reason: diagnostic.code, outcomeUnknown: !!error.outcomeUnknown });
    }
  };
}
async function audit(req, action, account) {
  await AuditLog.create({ tenantId: req.tenantId, actor: req.user?.sub || null, action,
    payload: { serverId: pickServerId(req), username: account } });
}
router.get('/profiles', endpoint(async (req, res) => res.json({ profiles: await service.profiles(context(req)) })));
router.get('/list', endpoint(async (req, res) => res.json({ users: await service.list(context(req)) })));
router.get('/online', endpoint(async (req, res) => res.json({ users: await service.online(context(req)) })));
router.post('/', requireRole('owner', 'admin'), endpoint(async (req, res) => {
  const body = z.object({ username, password, profile: username }).parse(req.body);
  const user = await service.add(context(req), body);
  await audit(req, 'pppoe.user.created', body.username);
  res.status(201).json({ ok: true, user });
}));
router.put('/update/:username', requireRole('owner', 'admin'), endpoint(async (req, res) => {
  const account = username.parse(req.params.username);
  await service.password(context(req), account, password.parse(req.body?.password));
  await audit(req, 'pppoe.password.updated', account);
  res.json({ ok: true });
}));
router.delete('/remove/:username', requireRole('owner', 'admin'), endpoint(async (req, res) => {
  const account = username.parse(req.params.username);
  await service.remove(context(req), account);
  await audit(req, 'pppoe.user.removed', account);
  res.json({ ok: true });
}));
module.exports = router;
