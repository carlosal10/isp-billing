const express = require('express');
const router = express.Router();
const Invoice = require('../models/Invoice');
const requireRole = require('../middleware/requireRole');
const {
  issueInvoiceForPlan,
  ensureInvoiceGenerated,
  markInvoicePaidManually,
  renderInvoiceHtml,
} = require('../services/billingFinanceService');
const { getInvoiceAudit } = require('../services/financeAuditService');

function serializeInvoice(invoice) {
  if (!invoice) return null;
  return {
    ...invoice.toObject(),
    amount: invoice.total,
    amountDue: invoice.total,
    customerName: invoice.customer?.name || null,
    accountNumber: invoice.customer?.accountNumber || null,
    planName: invoice.plan?.name || null,
  };
}

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const filter = { tenantId: req.tenantId };
    if (req.query.status) filter.status = String(req.query.status).trim();
    if (req.query.customerId) filter.customer = String(req.query.customerId).trim();

    const invoices = await Invoice.find(filter)
      .sort({ dueDate: -1, createdAt: -1 })
      .limit(limit)
      .populate('customer', 'name accountNumber')
      .populate('plan', 'name price duration');

    res.json(invoices.map(serializeInvoice));
  } catch (err) {
    console.error('invoice list error:', err);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const invoice = await getInvoiceAudit(req.tenantId, req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    return res.json(invoice);
  } catch (err) {
    console.error('invoice detail error:', err);
    return res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

router.post('/issue', requireRole('owner', 'admin'), async (req, res) => {
  const {
    customerId,
    planId,
    amount,
    issueDate,
    dueDate,
    servicePeriodStart,
    servicePeriodEnd,
    billingReason,
    lineItems,
  } = req.body || {};

  if (!customerId || !planId) {
    return res.status(400).json({ error: 'customerId and planId are required' });
  }

  try {
    const invoice = await issueInvoiceForPlan({
      tenantId: req.tenantId,
      customerId,
      planId,
      total: amount,
      issueDate: issueDate ? new Date(issueDate) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : new Date(),
      servicePeriodStart: servicePeriodStart ? new Date(servicePeriodStart) : null,
      servicePeriodEnd: servicePeriodEnd ? new Date(servicePeriodEnd) : null,
      billingReason: billingReason || 'manual',
      lineItems: Array.isArray(lineItems) ? lineItems : [],
      metadata: {
        issuedVia: 'api',
      },
    });
    return res.status(201).json({ ok: true, invoice: serializeInvoice(invoice) });
  } catch (err) {
    console.error('invoice issue error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to issue invoice' });
  }
});

router.put('/:id/pay', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { invoice, payment } = await markInvoicePaidManually({
      tenantId: req.tenantId,
      invoiceId: req.params.id,
      actor: {
        id: req.user?.email || req.user?.sub || req.user?.id || null,
      },
      note: typeof req.body?.note === 'string' ? req.body.note.trim() || null : null,
    });

    res.json({
      message: 'Invoice settled via manual payment',
      invoice: serializeInvoice(invoice),
      payment,
    });
  } catch (err) {
    console.error('invoice pay error:', err);
    res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to settle invoice' });
  }
});

router.post('/:id/generate', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const invoice = await ensureInvoiceGenerated({
      tenantId: req.tenantId,
      invoiceId: req.params.id,
    });

    res.json({ message: 'Invoice generated', invoice: serializeInvoice(invoice) });
  } catch (err) {
    console.error('invoice generate error:', err);
    res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to generate invoice' });
  }
});

router.get('/:id/pdf', async (req, res) => {
  try {
    await recalculateInvoice(req.params.id).catch(() => null);
    const invoice = await Invoice.findOne({ _id: req.params.id, tenantId: req.tenantId })
      .populate('customer', 'name accountNumber phone email')
      .populate('plan', 'name price duration');
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const html = renderInvoiceHtml(invoice);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('invoice pdf error:', err);
    res.status(500).json({ error: 'Failed to fetch invoice document' });
  }
});

module.exports = router;
