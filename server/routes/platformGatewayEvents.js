'use strict';

const express = require('express');
const AuditLog = require('../models/AuditLog');
const {
  listOrphanGatewayEvents,
  getOrphanGatewayEvent,
  getOrphanGatewayEventSummary,
  findTenantById,
  searchTenants,
  searchTenantPayments,
  searchTenantCustomers,
  claimOrphanGatewayEvent,
  releaseOrphanGatewayEvent,
  adoptOrphanGatewayEvent,
  listPlatformGatewayEventActions,
  logPlatformGatewayEventAction,
} = require('../services/platformGatewayEventService');
const {
  retryGatewayEvent,
  resolveGatewayEvent,
} = require('../services/paymentGatewayProcessingService');

const router = express.Router();

function platformActor(req) {
  const id = String(
    req.user?.email || req.user?.sub || req.user?.id || req.user?._id || ''
  );
  const display = String(
    req.user?.username ||
      req.user?.displayName ||
      req.user?.email ||
      req.user?.sub ||
      req.user?.id ||
      ''
  );
  return {
    id,
    display: display || id,
  };
}

async function auditTenantAction({ tenantId, actor, action, payload }) {
  if (!tenantId) return null;
  return AuditLog.create({
    tenantId,
    actor: actor || null,
    action,
    routerHost: null,
    payload: payload || null,
  }).catch(() => null);
}

async function ensureActorCanWorkEvent(req, eventId, note = null) {
  const actor = platformActor(req);
  const event = await getOrphanGatewayEvent(eventId);
  if (!event) {
    return {
      statusCode: 404,
      error: 'Orphan gateway event not found',
      actor,
      event: null,
    };
  }

  if (event.queueOwner && event.queueOwner !== actor.id) {
    await logPlatformGatewayEventAction({
      eventId,
      actor: actor.id,
      actorDisplay: actor.display,
      action: 'queue.conflict',
      note,
      ok: false,
      payload: {
        queueOwner: event.queueOwner,
        queueOwnerDisplay: event.queueOwnerDisplay || null,
      },
    });
    return {
      statusCode: 409,
      error: `Event is currently claimed by ${event.queueOwnerDisplay || event.queueOwner}`,
      actor,
      event,
    };
  }

  const reserved = await claimOrphanGatewayEvent({
    eventId,
    actor: actor.id,
    actorDisplay: actor.display,
  });
  if (!reserved) {
    return {
      statusCode: 409,
      error: 'Event could not be reserved for processing',
      actor,
      event,
    };
  }

  return { actor, event: reserved, statusCode: 200, error: null };
}

router.get('/orphans/summary', async (req, res) => {
  try {
    const summary = await getOrphanGatewayEventSummary(req.query, platformActor(req).id);
    return res.json(summary);
  } catch (err) {
    console.error('platform orphan event summary error:', err);
    return res.status(500).json({ error: 'Failed to fetch orphan gateway event summary' });
  }
});

router.get('/orphans', async (req, res) => {
  try {
    const events = await listOrphanGatewayEvents(req.query, platformActor(req).id);
    return res.json(events);
  } catch (err) {
    console.error('platform orphan events list error:', err);
    return res.status(500).json({ error: 'Failed to fetch orphan gateway events' });
  }
});

router.get('/orphans/:id/actions', async (req, res) => {
  try {
    const event = await getOrphanGatewayEvent(req.params.id);
    if (!event) {
      return res.status(404).json({ error: 'Orphan gateway event not found' });
    }
    const actions = await listPlatformGatewayEventActions({
      eventId: req.params.id,
      limit: req.query?.limit,
    });
    return res.json(actions);
  } catch (err) {
    console.error('platform orphan event action history error:', err);
    return res.status(500).json({ error: 'Failed to fetch orphan gateway event actions' });
  }
});

router.get('/orphans/:id', async (req, res) => {
  try {
    const event = await getOrphanGatewayEvent(req.params.id);
    if (!event) {
      return res.status(404).json({ error: 'Orphan gateway event not found' });
    }
    return res.json(event);
  } catch (err) {
    console.error('platform orphan event detail error:', err);
    return res.status(500).json({ error: 'Failed to fetch orphan gateway event detail' });
  }
});

router.get('/tenants/search', async (req, res) => {
  try {
    const tenants = await searchTenants(req.query?.query);
    return res.json(tenants);
  } catch (err) {
    console.error('platform tenant search error:', err);
    return res.status(500).json({ error: 'Failed to search tenants' });
  }
});

router.get('/tenants/:tenantId/payments/search', async (req, res) => {
  try {
    const tenant = await findTenantById(req.params.tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Target tenant not found' });
    }
    const payments = await searchTenantPayments({
      tenantId: req.params.tenantId,
      query: req.query?.query,
      provider: req.query?.provider,
    });
    return res.json(payments);
  } catch (err) {
    console.error('platform tenant payment search error:', err);
    return res.status(500).json({ error: 'Failed to search tenant payments' });
  }
});

router.get('/tenants/:tenantId/customers/search', async (req, res) => {
  try {
    const tenant = await findTenantById(req.params.tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Target tenant not found' });
    }
    const customers = await searchTenantCustomers({
      tenantId: req.params.tenantId,
      query: req.query?.query,
    });
    return res.json(customers);
  } catch (err) {
    console.error('platform tenant customer search error:', err);
    return res.status(500).json({ error: 'Failed to search tenant customers' });
  }
});

router.post('/orphans/:id/claim', async (req, res) => {
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() || null : null;
  const actor = platformActor(req);

  try {
    const claimed = await claimOrphanGatewayEvent({
      eventId: req.params.id,
      actor: actor.id,
      actorDisplay: actor.display,
    });

    if (!claimed) {
      const event = await getOrphanGatewayEvent(req.params.id);
      if (!event) {
        return res.status(404).json({ error: 'Orphan gateway event not found' });
      }
      return res.status(409).json({
        error: `Event is currently claimed by ${event.queueOwnerDisplay || event.queueOwner}`,
      });
    }

    await logPlatformGatewayEventAction({
      eventId: req.params.id,
      actor: actor.id,
      actorDisplay: actor.display,
      action: 'queue.claim',
      note,
      ok: true,
      payload: {
        queueOwner: claimed.queueOwner || actor.id,
      },
    });

    return res.json({ ok: true, event: claimed });
  } catch (err) {
    console.error('platform orphan event claim error:', err);
    return res.status(500).json({ error: 'Failed to claim orphan gateway event' });
  }
});

router.post('/orphans/:id/release', async (req, res) => {
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() || null : null;
  const actor = platformActor(req);

  try {
    const released = await releaseOrphanGatewayEvent({
      eventId: req.params.id,
      actor: actor.id,
      actorDisplay: actor.display,
    });

    if (!released) {
      const event = await getOrphanGatewayEvent(req.params.id);
      if (!event) {
        return res.status(404).json({ error: 'Orphan gateway event not found' });
      }
      return res.status(409).json({
        error: `Only ${event.queueOwnerDisplay || event.queueOwner} can release this claim`,
      });
    }

    await logPlatformGatewayEventAction({
      eventId: req.params.id,
      actor: actor.id,
      actorDisplay: actor.display,
      action: 'queue.release',
      note,
      ok: true,
      payload: {
        releasedBy: actor.id,
      },
    });

    return res.json({ ok: true, event: released });
  } catch (err) {
    console.error('platform orphan event release error:', err);
    return res.status(500).json({ error: 'Failed to release orphan gateway event claim' });
  }
});

router.post('/orphans/:id/adopt', async (req, res) => {
  const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() || null : null;

  if (!tenantId) {
    return res.status(400).json({ error: 'tenantId is required' });
  }

  try {
    const checkout = await ensureActorCanWorkEvent(req, req.params.id, note);
    if (checkout.error) {
      return res.status(checkout.statusCode).json({ error: checkout.error });
    }

    const tenant = await findTenantById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Target tenant not found' });
    }

    const adopted = await adoptOrphanGatewayEvent({
      eventId: req.params.id,
      tenantId,
    });

    if (!adopted) {
      return res.status(404).json({ error: 'Orphan gateway event not found or already assigned' });
    }

    await logPlatformGatewayEventAction({
      eventId: req.params.id,
      actor: checkout.actor.id,
      actorDisplay: checkout.actor.display,
      action: 'queue.adopt',
      note,
      ok: true,
      payload: {
        tenantId,
        tenantName: tenant.name || null,
        provider: adopted.provider || null,
        kind: adopted.kind || null,
      },
    });

    await auditTenantAction({
      tenantId,
      actor: checkout.actor.id,
      action: 'platform.payment.gateway-event.adopt',
      payload: {
        eventId: req.params.id,
        provider: adopted.provider || null,
        kind: adopted.kind || null,
        note,
        assignedBy: checkout.actor.id,
      },
    });

    return res.json({
      ok: true,
      event: adopted,
      tenant: { id: String(tenant._id), name: tenant.name },
    });
  } catch (err) {
    console.error('platform orphan event adopt error:', err);
    return res.status(500).json({ error: 'Failed to adopt orphan gateway event' });
  }
});

router.post('/orphans/:id/retry', async (req, res) => {
  const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() || null : null;

  if (!tenantId) {
    return res.status(400).json({ error: 'tenantId is required' });
  }

  try {
    const checkout = await ensureActorCanWorkEvent(req, req.params.id, note);
    if (checkout.error) {
      return res.status(checkout.statusCode).json({ error: checkout.error });
    }

    const tenant = await findTenantById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Target tenant not found' });
    }

    const adopted = await adoptOrphanGatewayEvent({
      eventId: req.params.id,
      tenantId,
    });
    if (!adopted) {
      return res.status(404).json({ error: 'Orphan gateway event not found or already assigned' });
    }

    const event = await retryGatewayEvent({
      tenantId,
      eventId: adopted._id,
    });

    await logPlatformGatewayEventAction({
      eventId: req.params.id,
      actor: checkout.actor.id,
      actorDisplay: checkout.actor.display,
      action: 'queue.retry',
      note,
      ok: true,
      payload: {
        tenantId,
        tenantName: tenant.name || null,
        statusAfter: event?.eventStatus || null,
      },
    });

    await auditTenantAction({
      tenantId,
      actor: checkout.actor.id,
      action: 'platform.payment.gateway-event.retry',
      payload: {
        eventId: req.params.id,
        provider: event?.provider || adopted.provider || null,
        kind: event?.kind || adopted.kind || null,
        note,
        assignedBy: checkout.actor.id,
        statusAfter: event?.eventStatus || null,
      },
    });

    return res.json({
      ok: true,
      event,
      tenant: { id: String(tenant._id), name: tenant.name },
    });
  } catch (err) {
    const status = Number(err?.statusCode) || 500;
    await logPlatformGatewayEventAction({
      eventId: req.params.id,
      actor: platformActor(req).id,
      actorDisplay: platformActor(req).display,
      action: 'queue.retry',
      note,
      ok: false,
      payload: { error: err?.message || 'Failed to retry orphan gateway event' },
    });
    console.error('platform orphan event retry error:', err);
    return res.status(status).json({ error: err?.message || 'Failed to retry orphan gateway event' });
  }
});

router.post('/orphans/:id/resolve', async (req, res) => {
  const tenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
  const paymentId =
    typeof req.body?.paymentId === 'string' ? req.body.paymentId.trim() || null : null;
  const customerId =
    typeof req.body?.customerId === 'string' ? req.body.customerId.trim() || null : null;
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() || null : null;

  if (!tenantId) {
    return res.status(400).json({ error: 'tenantId is required' });
  }

  try {
    const checkout = await ensureActorCanWorkEvent(req, req.params.id, note);
    if (checkout.error) {
      return res.status(checkout.statusCode).json({ error: checkout.error });
    }

    const tenant = await findTenantById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Target tenant not found' });
    }

    const adopted = await adoptOrphanGatewayEvent({
      eventId: req.params.id,
      tenantId,
    });
    if (!adopted) {
      return res.status(404).json({ error: 'Orphan gateway event not found or already assigned' });
    }

    const event = await resolveGatewayEvent({
      tenantId,
      eventId: adopted._id,
      paymentId,
      customerId,
    });

    await logPlatformGatewayEventAction({
      eventId: req.params.id,
      actor: checkout.actor.id,
      actorDisplay: checkout.actor.display,
      action: 'queue.resolve',
      note,
      ok: true,
      payload: {
        tenantId,
        tenantName: tenant.name || null,
        paymentId: paymentId || null,
        customerId: customerId || null,
        statusAfter: event?.eventStatus || null,
      },
    });

    await auditTenantAction({
      tenantId,
      actor: checkout.actor.id,
      action: 'platform.payment.gateway-event.resolve',
      payload: {
        eventId: req.params.id,
        provider: event?.provider || adopted.provider || null,
        kind: event?.kind || adopted.kind || null,
        note,
        paymentId: paymentId || null,
        customerId: customerId || null,
        assignedBy: checkout.actor.id,
        statusAfter: event?.eventStatus || null,
      },
    });

    return res.json({
      ok: true,
      event,
      tenant: { id: String(tenant._id), name: tenant.name },
    });
  } catch (err) {
    const status = Number(err?.statusCode) || 500;
    await logPlatformGatewayEventAction({
      eventId: req.params.id,
      actor: platformActor(req).id,
      actorDisplay: platformActor(req).display,
      action: 'queue.resolve',
      note,
      ok: false,
      payload: {
        paymentId: paymentId || null,
        customerId: customerId || null,
        error: err?.message || 'Failed to resolve orphan gateway event',
      },
    });
    console.error('platform orphan event resolve error:', err);
    return res.status(status).json({ error: err?.message || 'Failed to resolve orphan gateway event' });
  }
});

module.exports = router;
