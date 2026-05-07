'use strict';

const express = require('express');
const { apiKeyAuth, requireApiKeyScope } = require('../middleware/apiKey');
const {
  createIntegrationSupportTicket,
  getIntegrationCustomer,
  getIntegrationInvoice,
  listIntegrationCustomers,
  listIntegrationInvoices,
  listIntegrationPayments,
} = require('../services/integrationApiService');

const router = express.Router();

function apiKeyActor(req) {
  const key = req.apiKey || {};
  return {
    id: key.prefix ? `api-key:${key.prefix}` : `api-key:${key._id || 'unknown'}`,
    role: 'api-key',
  };
}

function serializeApiKeyContext(apiKey) {
  return {
    id: String(apiKey?._id || ''),
    label: apiKey?.label || null,
    prefix: apiKey?.prefix || null,
    scopes: Array.isArray(apiKey?.scopes) ? apiKey.scopes : [],
    expiresAt: apiKey?.expiresAt || null,
    lastUsedAt: apiKey?.lastUsedAt || null,
  };
}

function handleRouteError(res, err, fallbackMessage) {
  const status = err?.statusCode || 500;
  if (status >= 500) {
    console.error('[integration-api] route error:', err);
  }
  return res.status(status).json({ error: err?.message || fallbackMessage });
}

router.use(apiKeyAuth);

router.get('/v1/health', (req, res) => {
  res.json({
    ok: true,
    version: 'v1',
    tenantId: String(req.tenantId || ''),
    apiKey: serializeApiKeyContext(req.apiKey),
  });
});

router.get('/v1/customers', requireApiKeyScope('customers:read'), async (req, res) => {
  try {
    const customers = await listIntegrationCustomers(req.tenantId, {
      q: req.query.q,
      status: req.query.status,
      limit: req.query.limit,
    });
    res.json({ data: customers });
  } catch (err) {
    handleRouteError(res, err, 'Failed to fetch customers');
  }
});

router.get('/v1/customers/:id', requireApiKeyScope('customers:read'), async (req, res) => {
  try {
    const customer = await getIntegrationCustomer(req.tenantId, req.params.id);
    res.json({ data: customer });
  } catch (err) {
    handleRouteError(res, err, 'Failed to fetch customer');
  }
});

router.get('/v1/invoices', requireApiKeyScope('invoices:read'), async (req, res) => {
  try {
    const invoices = await listIntegrationInvoices(req.tenantId, {
      customerId: req.query.customerId,
      status: req.query.status,
      limit: req.query.limit,
    });
    res.json({ data: invoices });
  } catch (err) {
    handleRouteError(res, err, 'Failed to fetch invoices');
  }
});

router.get('/v1/invoices/:id', requireApiKeyScope('invoices:read'), async (req, res) => {
  try {
    const invoice = await getIntegrationInvoice(req.tenantId, req.params.id);
    res.json({ data: invoice });
  } catch (err) {
    handleRouteError(res, err, 'Failed to fetch invoice');
  }
});

router.get('/v1/payments', requireApiKeyScope('payments:read'), async (req, res) => {
  try {
    const payments = await listIntegrationPayments(req.tenantId, {
      limit: req.query.limit,
    });
    res.json({ data: payments });
  } catch (err) {
    handleRouteError(res, err, 'Failed to fetch payments');
  }
});

router.post('/v1/support/tickets', requireApiKeyScope('support:write'), async (req, res) => {
  try {
    const ticket = await createIntegrationSupportTicket(req.tenantId, req.body || {}, apiKeyActor(req));
    res.status(201).json({ data: ticket });
  } catch (err) {
    handleRouteError(res, err, 'Failed to create support ticket');
  }
});

module.exports = router;
