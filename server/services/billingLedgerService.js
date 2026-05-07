'use strict';

const BillingLedgerEntry = require('../models/BillingLedgerEntry');
const { roundCurrency } = require('./billingMath');

function totalByDirection(entries, direction) {
  return roundCurrency(
    entries
      .filter((entry) => entry.direction === direction)
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
  );
}

async function createLedgerBatch({
  tenantId,
  batchId,
  sourceType,
  sourceId = null,
  customerId = null,
  invoiceId = null,
  paymentId = null,
  creditNoteId = null,
  description = null,
  effectiveAt = new Date(),
  currency = 'KES',
  entries = [],
  metadata = {},
}) {
  if (!batchId) {
    throw new Error('batchId is required');
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Ledger batch entries are required');
  }

  const normalizedEntries = entries.map((entry) => ({
    tenantId,
    batchId,
    sourceType,
    sourceId,
    customer: customerId,
    invoice: entry.invoiceId || invoiceId || null,
    payment: entry.paymentId || paymentId || null,
    creditNote: entry.creditNoteId || creditNoteId || null,
    account: String(entry.account || '').trim(),
    direction: entry.direction,
    amount: roundCurrency(entry.amount),
    currency: String(entry.currency || currency || 'KES').trim().toUpperCase(),
    description: entry.description || description || null,
    effectiveAt,
    metadata: {
      ...metadata,
      ...(entry.metadata || {}),
    },
  }));

  const debitTotal = totalByDirection(normalizedEntries, 'debit');
  const creditTotal = totalByDirection(normalizedEntries, 'credit');
  if (debitTotal <= 0 || creditTotal <= 0 || debitTotal !== creditTotal) {
    throw new Error(`Unbalanced ledger batch ${batchId}`);
  }

  return BillingLedgerEntry.insertMany(normalizedEntries, { ordered: true });
}

async function reverseLedgerBatch({
  tenantId,
  batchId,
  reversalBatchId,
  effectiveAt = new Date(),
  description = null,
  metadata = {},
}) {
  const activeEntries = await BillingLedgerEntry.find({
    tenantId,
    batchId,
    reversedAt: null,
  }).lean();

  if (activeEntries.length === 0) {
    return [];
  }

  const reversedEntries = activeEntries.map((entry) => ({
    tenantId: entry.tenantId,
    batchId: reversalBatchId,
    sourceType: 'reversal',
    sourceId: entry.sourceId || null,
    customer: entry.customer || null,
    invoice: entry.invoice || null,
    payment: entry.payment || null,
    creditNote: entry.creditNote || null,
    account: entry.account,
    direction: entry.direction === 'debit' ? 'credit' : 'debit',
    amount: roundCurrency(entry.amount),
    currency: entry.currency || 'KES',
    description: description || `Reversal of ${batchId}`,
    effectiveAt,
    metadata: {
      ...metadata,
      reversesBatchId: batchId,
    },
  }));

  await BillingLedgerEntry.insertMany(reversedEntries, { ordered: true });
  await BillingLedgerEntry.updateMany(
    { tenantId, batchId, reversedAt: null },
    {
      $set: {
        reversedAt: effectiveAt,
        reversalBatchId,
      },
    }
  );

  return reversedEntries;
}

module.exports = {
  createLedgerBatch,
  reverseLedgerBatch,
};
