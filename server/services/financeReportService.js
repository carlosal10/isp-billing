'use strict';

const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const CreditNote = require('../models/CreditNote');
const BillingLedgerEntry = require('../models/BillingLedgerEntry');
const { roundCurrency, diffDays, agingBucket } = require('./billingMath');

async function getFinanceSummary(tenantId) {
  const [invoiceTotals, paymentTotals, creditTotals] = await Promise.all([
    Invoice.aggregate([
      { $match: { tenantId } },
      {
        $group: {
          _id: null,
          totalInvoiced: { $sum: '$total' },
          totalPaid: { $sum: '$amountPaid' },
          totalCredited: { $sum: '$amountCredited' },
          totalOutstanding: { $sum: '$balanceDue' },
          overdueOutstanding: {
            $sum: {
              $cond: [{ $eq: ['$status', 'overdue'] }, '$balanceDue', 0],
            },
          },
        },
      },
    ]),
    Payment.aggregate([
      {
        $match: {
          tenantId,
          isDeleted: { $ne: true },
        },
      },
      {
        $group: {
          _id: null,
          collected: {
            $sum: {
              $cond: [
                { $in: ['$status', ['Success', 'Validated']] },
                '$amount',
                0,
              ],
            },
          },
          refunded: { $sum: '$refundAmount' },
          chargebacks: { $sum: '$chargebackAmount' },
        },
      },
    ]),
    CreditNote.aggregate([
      {
        $match: {
          tenantId,
          status: { $ne: 'reversed' },
        },
      },
      {
        $group: {
          _id: null,
          totalCredits: { $sum: '$amount' },
          unappliedCredits: { $sum: '$remainingAmount' },
        },
      },
    ]),
  ]);

  const invoices = invoiceTotals[0] || {};
  const payments = paymentTotals[0] || {};
  const credits = creditTotals[0] || {};

  return {
    totalInvoiced: roundCurrency(invoices.totalInvoiced || 0),
    totalPaidOnInvoices: roundCurrency(invoices.totalPaid || 0),
    totalCreditedOnInvoices: roundCurrency(invoices.totalCredited || 0),
    totalOutstanding: roundCurrency(invoices.totalOutstanding || 0),
    overdueOutstanding: roundCurrency(invoices.overdueOutstanding || 0),
    collectedCash: roundCurrency(payments.collected || 0),
    refundedCash: roundCurrency(payments.refunded || 0),
    chargebackExposure: roundCurrency(payments.chargebacks || 0),
    totalCreditsIssued: roundCurrency(credits.totalCredits || 0),
    unappliedCredits: roundCurrency(credits.unappliedCredits || 0),
  };
}

async function getInvoiceAgingReport(tenantId) {
  const invoices = await Invoice.find({
    tenantId,
    status: { $in: ['issued', 'partially_paid', 'overdue'] },
    balanceDue: { $gt: 0 },
  })
    .populate('customer', 'name accountNumber')
    .populate('plan', 'name')
    .sort({ dueDate: 1, createdAt: 1 })
    .lean();

  const buckets = {
    '0-30': 0,
    '31-60': 0,
    '61-90': 0,
    '90+': 0,
  };
  const rows = invoices.map((invoice) => {
    const daysOverdue = Math.max(0, diffDays(new Date(), invoice.dueDate));
    const bucket = agingBucket(daysOverdue);
    buckets[bucket] += roundCurrency(invoice.balanceDue || 0);
    return {
      _id: invoice._id,
      invoiceNumber: invoice.invoiceNumber || null,
      customerId: invoice.customer?._id || null,
      customerName: invoice.customer?.name || null,
      accountNumber: invoice.customer?.accountNumber || null,
      planName: invoice.plan?.name || null,
      dueDate: invoice.dueDate,
      status: invoice.status,
      dunningStage: invoice.dunningStage || null,
      balanceDue: roundCurrency(invoice.balanceDue || 0),
      daysOverdue,
      bucket,
    };
  });

  return {
    buckets: Object.fromEntries(
      Object.entries(buckets).map(([key, value]) => [key, roundCurrency(value)])
    ),
    rows,
  };
}

async function listCustomerCredits(tenantId, options = {}) {
  const limit = Math.min(Number(options.limit) || 100, 300);
  const filter = {
    tenantId,
    status: { $in: ['open', 'partially_applied', 'applied'] },
  };
  if (options.onlyOpen === 'true' || options.onlyOpen === true) {
    filter.remainingAmount = { $gt: 0 };
  }

  const notes = await CreditNote.find(filter)
    .populate('customer', 'name accountNumber')
    .populate('sourcePayment', 'transactionId method status')
    .sort({ issuedAt: -1, createdAt: -1 })
    .limit(limit)
    .lean();

  return notes.map((note) => ({
    _id: note._id,
    creditNoteNumber: note.creditNoteNumber || null,
    customerName: note.customer?.name || null,
    accountNumber: note.customer?.accountNumber || null,
    amount: roundCurrency(note.amount || 0),
    remainingAmount: roundCurrency(note.remainingAmount || 0),
    status: note.status,
    reason: note.reason || null,
    issuedAt: note.issuedAt || note.createdAt,
    sourcePayment: note.sourcePayment
      ? {
          _id: note.sourcePayment._id,
          transactionId: note.sourcePayment.transactionId || null,
          method: note.sourcePayment.method || null,
          status: note.sourcePayment.status || null,
        }
      : null,
  }));
}

async function listLedgerEntries(tenantId, options = {}) {
  const limit = Math.min(Number(options.limit) || 100, 300);
  const filter = { tenantId };
  if (options.account) filter.account = String(options.account).trim();
  if (options.sourceType) filter.sourceType = String(options.sourceType).trim();
  if (options.customerId) filter.customer = String(options.customerId).trim();
  if (options.invoiceId) filter.invoice = String(options.invoiceId).trim();
  if (options.paymentId) filter.payment = String(options.paymentId).trim();

  const rows = await BillingLedgerEntry.find(filter)
    .sort({ effectiveAt: -1, createdAt: -1 })
    .limit(limit)
    .lean();

  return rows.map((row) => ({
    _id: row._id,
    batchId: row.batchId,
    sourceType: row.sourceType,
    sourceId: row.sourceId || null,
    customerId: row.customer || null,
    invoiceId: row.invoice || null,
    paymentId: row.payment || null,
    creditNoteId: row.creditNote || null,
    account: row.account,
    direction: row.direction,
    amount: roundCurrency(row.amount || 0),
    currency: row.currency || 'KES',
    description: row.description || null,
    effectiveAt: row.effectiveAt,
    reversedAt: row.reversedAt || null,
    metadata: row.metadata || {},
  }));
}

module.exports = {
  getFinanceSummary,
  getInvoiceAgingReport,
  listCustomerCredits,
  listLedgerEntries,
};
