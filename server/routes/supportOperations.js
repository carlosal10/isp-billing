'use strict';

const express = require('express');
const requireRole = require('../middleware/requireRole');
const {
  createSupportTicket,
  createWorkOrder,
  getSupportSummary,
  listSupportTickets,
  listWorkOrders,
  updateSupportTicket,
  updateWorkOrder,
} = require('../services/supportOperationsService');

const router = express.Router();

function requestActor(req) {
  return {
    id: String(req.user?.email || req.user?.sub || req.user?.id || req.user?._id || ''),
    email: req.user?.email || null,
    role: req.role || (req.user?.isPlatformAdmin ? 'platform-admin' : null),
  };
}

router.get('/summary', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const summary = await getSupportSummary(req.tenantId);
    return res.json(summary);
  } catch (err) {
    console.error('support summary error:', err);
    return res.status(500).json({ error: 'Failed to load support summary' });
  }
});

router.get('/tickets', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const tickets = await listSupportTickets(req.tenantId, req.query);
    return res.json(tickets);
  } catch (err) {
    console.error('support tickets list error:', err);
    return res.status(500).json({ error: 'Failed to load support tickets' });
  }
});

router.post('/tickets', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const ticket = await createSupportTicket(req.tenantId, req.body, requestActor(req));
    return res.status(201).json({ ok: true, ticket });
  } catch (err) {
    console.error('support ticket create error:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to create support ticket' });
  }
});

router.put('/tickets/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const ticket = await updateSupportTicket(req.tenantId, req.params.id, req.body, requestActor(req));
    return res.json({ ok: true, ticket });
  } catch (err) {
    console.error('support ticket update error:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to update support ticket' });
  }
});

router.get('/work-orders', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const orders = await listWorkOrders(req.tenantId, req.query);
    return res.json(orders);
  } catch (err) {
    console.error('support work orders list error:', err);
    return res.status(500).json({ error: 'Failed to load work orders' });
  }
});

router.post('/work-orders', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const workOrder = await createWorkOrder(req.tenantId, req.body, requestActor(req));
    return res.status(201).json({ ok: true, workOrder });
  } catch (err) {
    console.error('support work order create error:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to create work order' });
  }
});

router.put('/work-orders/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const workOrder = await updateWorkOrder(req.tenantId, req.params.id, req.body, requestActor(req));
    return res.json({ ok: true, workOrder });
  } catch (err) {
    console.error('support work order update error:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to update work order' });
  }
});

module.exports = router;
