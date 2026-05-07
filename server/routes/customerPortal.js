'use strict';

const express = require('express');
const requirePortalAuth = require('../middleware/requirePortalAuth');
const {
  createPortalTicket,
  getPortalOverview,
  getPortalPaymentStatus,
  initiatePortalMpesaPayment,
  listPortalIncidents,
  listPortalInvoices,
  listPortalPayments,
  listPortalTickets,
  updatePortalPin,
} = require('../services/customerPortalService');

const router = express.Router();

router.use(requirePortalAuth);

router.get('/overview', async (req, res) => {
  try {
    const overview = await getPortalOverview(req.tenantId, req.portalCustomerId);
    overview.tenant = {
      ...(overview.tenant || {}),
      name: req.user?.tenantName || overview.tenant?.name || null,
    };
    return res.json(overview);
  } catch (err) {
    console.error('portal overview error:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to load portal overview' });
  }
});

router.get('/invoices', async (req, res) => {
  try {
    const invoices = await listPortalInvoices(req.tenantId, req.portalCustomerId, req.query.limit);
    return res.json(invoices);
  } catch (err) {
    console.error('portal invoices error:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to load invoices' });
  }
});

router.get('/payments', async (req, res) => {
  try {
    const payments = await listPortalPayments(req.tenantId, req.portalCustomerId, req.query.limit);
    return res.json(payments);
  } catch (err) {
    console.error('portal payments error:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to load payments' });
  }
});

router.get('/payments/:id/status', async (req, res) => {
  try {
    const payment = await getPortalPaymentStatus(req.tenantId, req.portalCustomerId, req.params.id);
    return res.json(payment);
  } catch (err) {
    console.error('portal payment status error:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to load payment status' });
  }
});

router.post('/payments/mpesa/stk', async (req, res) => {
  try {
    const result = await initiatePortalMpesaPayment(req.tenantId, req.portalCustomerId, req.body || {});
    return res.status(201).json(result);
  } catch (err) {
    console.error('portal mpesa stk error:', err);
    return res.status(err?.statusCode || 500).json({
      error: err?.message || 'Failed to initiate M-Pesa payment',
      darajaStatus: err?.darajaStatus || err?.response?.status || null,
      darajaResponse: err?.darajaResponse || err?.response?.data || null,
    });
  }
});

router.get('/tickets', async (req, res) => {
  try {
    const tickets = await listPortalTickets(req.tenantId, req.portalCustomerId, req.query.limit);
    return res.json(tickets);
  } catch (err) {
    console.error('portal tickets error:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to load tickets' });
  }
});

router.post('/tickets', async (req, res) => {
  try {
    const ticket = await createPortalTicket(req.tenantId, req.portalCustomerId, req.body || {});
    return res.status(201).json({ ok: true, ticket });
  } catch (err) {
    console.error('portal ticket create error:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to create support request' });
  }
});

router.get('/incidents', async (req, res) => {
  try {
    const incidents = await listPortalIncidents(req.tenantId, req.portalCustomerId, {
      activeOnly: req.query.all !== 'true',
      limit: req.query.limit,
    });
    return res.json(incidents);
  } catch (err) {
    console.error('portal incidents error:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to load incidents' });
  }
});

router.post('/security/pin', async (req, res) => {
  try {
    const result = await updatePortalPin(req.tenantId, req.portalCustomerId, req.body || {});
    return res.json(result);
  } catch (err) {
    console.error('portal pin update error:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to update portal PIN' });
  }
});

module.exports = router;
