'use strict';

const express = require('express');
const requireRole = require('../middleware/requireRole');
const {
  getFinanceSummary,
  getInvoiceAgingReport,
  listCustomerCredits,
  listLedgerEntries,
} = require('../services/financeReportService');

const router = express.Router();
const { getReconciliation } = require('../services/reconciliationService');
const AccessOutbox = require('../models/AccessOutbox');
const AuditLog = require('../models/AuditLog');
const { financialTransaction } = require('../services/financialTransaction');
const { syncPaymentFinancials } = require('../services/billingFinanceService');
const Payment = require('../models/Payment');
const Statement = require('../models/ProviderStatement');
const { importStatement, getStatementReport, acknowledgeDiscrepancy } = require('../services/providerReconciliationService');
function statementError(err, res, next) {
  if (err.statusCode || err.name === 'CastError') return res.status(err.statusCode || 400).json({ error: err.message });
  next(err);
}
router.get('/statements', requireRole('owner', 'admin'), async (req, res, next) => {
  try { res.json(await Statement.find({ tenantId: req.tenantId }).select('-rows -acknowledgements').sort({ createdAt: -1 }).limit(50).lean()); }
  catch (err) { statementError(err, res, next); }
});
router.post('/statements', requireRole('owner', 'admin'), async (req, res, next) => {
  try { const { provider, start, end, rows } = req.body || {}; res.status(201).json(await importStatement({ provider, start, end, rows, tenantId: req.tenantId, actor: String(req.user.sub) })); }
  catch (err) { statementError(err, res, next); }
});
router.get('/statements/:id', requireRole('owner', 'admin'), async (req, res, next) => {
  try { res.json(await getStatementReport(req.tenantId, req.params.id)); }
  catch (err) { statementError(err, res, next); }
});
router.post('/statements/:id/acknowledge', requireRole('owner', 'admin'), async (req, res, next) => {
  try { await acknowledgeDiscrepancy({ tenantId: req.tenantId, id: req.params.id, key: req.body?.key, reason: req.body?.reason, actor: String(req.user.sub) }); res.json({ ok: true }); }
  catch (err) { statementError(err, res, next); }
});

router.get('/reconciliation', requireRole('owner', 'admin'), async (req, res, next) => {
  try { res.json(await getReconciliation(req.tenantId)); } catch (err) { next(err); }
});
router.post('/recovery/:kind/:id', requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 5 || reason.length > 500 || !['access', 'payment'].includes(req.params.kind)) return res.status(400).json({ error: 'A recovery type and reason (5–500 characters) are required' });
    await financialTransaction(async () => {
      if (req.params.kind === 'payment') {
        const payment = await Payment.findOne({ _id: req.params.id, tenantId: req.tenantId, status: { $in: ['Success', 'Validated'] }, isDeleted: false });
        if (!payment) throw Object.assign(new Error('Payment not found'), { statusCode: 404 });
        await syncPaymentFinancials({ paymentId: payment._id, reason });
      } else {
        const result = await AccessOutbox.updateOne({ _id: req.params.id, tenantId: req.tenantId, status: { $in: ['failed', 'pending'] } },
          { $set: { status: 'pending', attempts: 0, nextAttemptAt: new Date() }, $inc: { generation: 1 } });
        if (!result.matchedCount) throw Object.assign(new Error('Recoverable job not found'), { statusCode: 404 });
      }
      await AuditLog.create({ tenantId: req.tenantId, actor: String(req.user.sub), action: 'finance.recovery', payload: { kind: req.params.kind, id: req.params.id, reason } });
    });
    res.json({ ok: true });
  } catch (err) { if (err.statusCode) return res.status(err.statusCode).json({ error: err.message }); next(err); }
});

router.get('/summary', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const summary = await getFinanceSummary(req.tenantId);
    res.json(summary);
  } catch (err) {
    console.error('finance summary error:', err);
    res.status(500).json({ error: 'Failed to load finance summary' });
  }
});

router.get('/invoice-aging', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const aging = await getInvoiceAgingReport(req.tenantId);
    res.json(aging);
  } catch (err) {
    console.error('finance aging error:', err);
    res.status(500).json({ error: 'Failed to load invoice aging' });
  }
});

router.get('/credits', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const rows = await listCustomerCredits(req.tenantId, req.query);
    res.json(rows);
  } catch (err) {
    console.error('finance credits error:', err);
    res.status(500).json({ error: 'Failed to load customer credits' });
  }
});

router.get('/ledger', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const rows = await listLedgerEntries(req.tenantId, req.query);
    res.json(rows);
  } catch (err) {
    console.error('finance ledger error:', err);
    res.status(500).json({ error: 'Failed to load ledger entries' });
  }
});

module.exports = router;
