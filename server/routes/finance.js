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
