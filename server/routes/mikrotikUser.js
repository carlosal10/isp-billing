'use strict';
const express = require('express');
const { z } = require('zod');
const requireRole = require('../middleware/requireRole');
const service = require('../services/pppoeService');
const { pickServerId } = require('../services/mikrotikSupport');
const { connectionDiagnostic } = require('../services/routerConnectionDiagnostics');
const router = express.Router();
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
router.get('/profiles', endpoint(async (req, res) => res.json({ profiles: await service.profiles(context(req)) })));
router.get('/list', endpoint(async (req, res) => res.json({ users: await service.list(context(req)) })));
router.get('/online', endpoint(async (req, res) => res.json({ users: await service.online(context(req)) })));
// Historical write endpoints cannot bypass assignment ownership, billing or leases.
const managedOnly = endpoint(async () => { throw Object.assign(new Error('Use the linked subscriber service workflow to create, change credentials or release PPPoE accounts.'), { statusCode: 409 }); });
router.post('/', requireRole('owner', 'admin'), managedOnly);
router.put('/update/:username', requireRole('owner', 'admin'), managedOnly);
router.delete('/remove/:username', requireRole('owner', 'admin'), managedOnly);
module.exports = router;
