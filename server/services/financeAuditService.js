'use strict';

const Payment = require('../models/Payment');
const Invoice = require('../models/Invoice');
const CreditNote = require('../models/CreditNote');
const InvoiceAllocation = require('../models/InvoiceAllocation');
const BillingLedgerEntry = require('../models/BillingLedgerEntry');
const { roundCurrency } = require('./billingMath');
const { recalculateInvoice } = require('./billingFinanceService');

function toPlain(document) {
  if (!document) return null;
  return typeof document.toObject === 'function' ? document.toObject() : document;
}

function toId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}

function sumByDirection(rows, direction) {
  return roundCurrency(
    rows
      .filter((row) => row.direction === direction)
      .reduce((total, row) => total + Number(row.amount || 0), 0)
  );
}

function serializeLedgerEntry(row) {
  const entry = toPlain(row);
  return {
    _id: toId(entry._id),
    batchId: entry.batchId || null,
    sourceType: entry.sourceType || null,
    sourceId: toId(entry.sourceId),
    customerId: toId(entry.customer),
    invoiceId: toId(entry.invoice),
    paymentId: toId(entry.payment),
    creditNoteId: toId(entry.creditNote),
    account: entry.account || null,
    direction: entry.direction || null,
    amount: roundCurrency(entry.amount || 0),
    currency: entry.currency || 'KES',
    description: entry.description || null,
    effectiveAt: entry.effectiveAt || entry.createdAt || null,
    reversedAt: entry.reversedAt || null,
    reversalBatchId: entry.reversalBatchId || null,
    metadata: entry.metadata || {},
  };
}

function serializeCreditNote(row) {
  const note = toPlain(row);
  return {
    _id: toId(note._id),
    creditNoteNumber: note.creditNoteNumber || null,
    customer: note.customer
      ? {
          _id: toId(note.customer._id || note.customer),
          name: note.customer.name || null,
          accountNumber: note.customer.accountNumber || null,
        }
      : null,
    sourcePayment: note.sourcePayment
      ? {
          _id: toId(note.sourcePayment._id || note.sourcePayment),
          transactionId: note.sourcePayment.transactionId || null,
          method: note.sourcePayment.method || null,
          status: note.sourcePayment.status || null,
          amount: roundCurrency(note.sourcePayment.amount || 0),
        }
      : null,
    sourceInvoice: note.sourceInvoice
      ? {
          _id: toId(note.sourceInvoice._id || note.sourceInvoice),
          invoiceNumber: note.sourceInvoice.invoiceNumber || null,
          status: note.sourceInvoice.status || null,
          total: roundCurrency(note.sourceInvoice.total || 0),
          balanceDue: roundCurrency(note.sourceInvoice.balanceDue || 0),
        }
      : null,
    amount: roundCurrency(note.amount || 0),
    remainingAmount: roundCurrency(note.remainingAmount || 0),
    status: note.status || null,
    reason: note.reason || null,
    issuedAt: note.issuedAt || note.createdAt || null,
    appliedAt: note.appliedAt || null,
    reversedAt: note.reversedAt || null,
    reversedReason: note.reversedReason || null,
    metadata: note.metadata || {},
  };
}

function serializeInvoiceAllocation(row) {
  const allocation = toPlain(row);
  return {
    _id: toId(allocation._id),
    sourceType: allocation.sourceType || null,
    status: allocation.status || null,
    amount: roundCurrency(allocation.amount || 0),
    currency: allocation.currency || 'KES',
    appliedAt: allocation.appliedAt || allocation.createdAt || null,
    reversedAt: allocation.reversedAt || null,
    reversalReason: allocation.reversalReason || null,
    note: allocation.note || null,
    batchId: allocation.batchId || null,
    invoice: allocation.invoice
      ? {
          _id: toId(allocation.invoice._id || allocation.invoice),
          invoiceNumber: allocation.invoice.invoiceNumber || null,
          status: allocation.invoice.status || null,
          total: roundCurrency(allocation.invoice.total || 0),
          balanceDue: roundCurrency(allocation.invoice.balanceDue || 0),
          dueDate: allocation.invoice.dueDate || null,
        }
      : null,
    payment: allocation.payment
      ? {
          _id: toId(allocation.payment._id || allocation.payment),
          transactionId: allocation.payment.transactionId || null,
          method: allocation.payment.method || null,
          status: allocation.payment.status || null,
          amount: roundCurrency(allocation.payment.amount || 0),
          createdAt: allocation.payment.createdAt || null,
        }
      : null,
    creditNote: allocation.creditNote
      ? {
          _id: toId(allocation.creditNote._id || allocation.creditNote),
          creditNoteNumber: allocation.creditNote.creditNoteNumber || null,
          status: allocation.creditNote.status || null,
          amount: roundCurrency(allocation.creditNote.amount || 0),
          remainingAmount: roundCurrency(allocation.creditNote.remainingAmount || 0),
        }
      : null,
  };
}

function serializeInvoice(invoiceDoc) {
  const invoice = toPlain(invoiceDoc);
  return {
    ...invoice,
    _id: toId(invoice._id),
    customerName: invoice.customer?.name || null,
    accountNumber: invoice.customer?.accountNumber || null,
    planName: invoice.plan?.name || null,
    amount: roundCurrency(invoice.total || 0),
    amountDue: roundCurrency(invoice.total || 0),
    total: roundCurrency(invoice.total || 0),
    subtotal: roundCurrency(invoice.subtotal || 0),
    discountTotal: roundCurrency(invoice.discountTotal || 0),
    taxTotal: roundCurrency(invoice.taxTotal || 0),
    amountPaid: roundCurrency(invoice.amountPaid || 0),
    amountCredited: roundCurrency(invoice.amountCredited || 0),
    balanceDue: roundCurrency(invoice.balanceDue || 0),
  };
}

function serializePayment(paymentDoc) {
  const payment = toPlain(paymentDoc);
  return {
    ...payment,
    _id: toId(payment._id),
    customerName: payment.customer?.name || null,
    accountNumber: payment.accountNumber || payment.customer?.accountNumber || null,
    planName: payment.plan?.name || null,
    invoiceNumber: payment.invoice?.invoiceNumber || null,
    amount: roundCurrency(payment.amount || 0),
    allocatedAmount: roundCurrency(payment.allocatedAmount || 0),
    unappliedAmount: roundCurrency(payment.unappliedAmount || 0),
    refundAmount: roundCurrency(payment.refundAmount || 0),
    chargebackAmount: roundCurrency(payment.chargebackAmount || 0),
  };
}

async function getPaymentAudit(tenantId, paymentId) {
  const payment = await Payment.findOne({ _id: paymentId, tenantId })
    .populate('customer', 'name accountNumber phone email connectionType')
    .populate('plan', 'name price duration durationDays')
    .populate('invoice', 'invoiceNumber status total balanceDue dueDate amountPaid amountCredited');

  if (!payment) return null;

  const [allocations, creditNotes] = await Promise.all([
    InvoiceAllocation.find({ tenantId, payment: payment._id })
      .sort({ appliedAt: -1, createdAt: -1 })
      .populate('invoice', 'invoiceNumber status total balanceDue dueDate')
      .populate('payment', 'transactionId method status amount createdAt')
      .populate('creditNote', 'creditNoteNumber status amount remainingAmount'),
    CreditNote.find({ tenantId, sourcePayment: payment._id })
      .sort({ issuedAt: -1, createdAt: -1 })
      .populate('customer', 'name accountNumber')
      .populate('sourcePayment', 'transactionId method status amount')
      .populate('sourceInvoice', 'invoiceNumber status total balanceDue'),
  ]);

  const creditNoteIds = creditNotes.map((note) => note._id);
  const ledgerFilter = { tenantId, payment: payment._id };
  if (creditNoteIds.length) {
    ledgerFilter.$or = [
      { payment: payment._id },
      { creditNote: { $in: creditNoteIds } },
    ];
    delete ledgerFilter.payment;
  }

  const ledgerEntries = await BillingLedgerEntry.find(ledgerFilter)
    .sort({ effectiveAt: -1, createdAt: -1 });

  const serializedAllocations = allocations.map(serializeInvoiceAllocation);
  const serializedCredits = creditNotes.map(serializeCreditNote);
  const serializedLedger = ledgerEntries.map(serializeLedgerEntry);

  return {
    ...serializePayment(payment),
    totals: {
      allocatedAmount: roundCurrency(payment.allocatedAmount || 0),
      unappliedAmount: roundCurrency(payment.unappliedAmount || 0),
      creditIssued: roundCurrency(
        serializedCredits.reduce((total, note) => total + Number(note.amount || 0), 0)
      ),
      creditRemaining: roundCurrency(
        serializedCredits.reduce((total, note) => total + Number(note.remainingAmount || 0), 0)
      ),
      ledgerDebitTotal: sumByDirection(serializedLedger, 'debit'),
      ledgerCreditTotal: sumByDirection(serializedLedger, 'credit'),
    },
    allocations: serializedAllocations,
    creditNotes: serializedCredits,
    ledgerEntries: serializedLedger,
  };
}

async function getInvoiceAudit(tenantId, invoiceId) {
  const invoice = await Invoice.findOne({ _id: invoiceId, tenantId })
    .populate('customer', 'name accountNumber phone email connectionType')
    .populate('plan', 'name price duration durationDays');

  if (!invoice) return null;

  await recalculateInvoice(invoice._id);
  const refreshedInvoice = await Invoice.findById(invoice._id)
    .populate('customer', 'name accountNumber phone email connectionType')
    .populate('plan', 'name price duration durationDays');

  const [allocations, sourceCreditNotes, ledgerEntries] = await Promise.all([
    InvoiceAllocation.find({ tenantId, invoice: invoice._id })
      .sort({ appliedAt: -1, createdAt: -1 })
      .populate('invoice', 'invoiceNumber status total balanceDue dueDate')
      .populate('payment', 'transactionId method status amount createdAt')
      .populate('creditNote', 'creditNoteNumber status amount remainingAmount'),
    CreditNote.find({ tenantId, sourceInvoice: invoice._id })
      .sort({ issuedAt: -1, createdAt: -1 })
      .populate('customer', 'name accountNumber')
      .populate('sourcePayment', 'transactionId method status amount')
      .populate('sourceInvoice', 'invoiceNumber status total balanceDue'),
    BillingLedgerEntry.find({ tenantId, invoice: invoice._id })
      .sort({ effectiveAt: -1, createdAt: -1 }),
  ]);

  const serializedAllocations = allocations.map(serializeInvoiceAllocation);
  const serializedCredits = sourceCreditNotes.map(serializeCreditNote);
  const serializedLedger = ledgerEntries.map(serializeLedgerEntry);

  return {
    ...serializeInvoice(refreshedInvoice),
    totals: {
      total: roundCurrency(refreshedInvoice.total || 0),
      amountPaid: roundCurrency(refreshedInvoice.amountPaid || 0),
      amountCredited: roundCurrency(refreshedInvoice.amountCredited || 0),
      balanceDue: roundCurrency(refreshedInvoice.balanceDue || 0),
      ledgerDebitTotal: sumByDirection(serializedLedger, 'debit'),
      ledgerCreditTotal: sumByDirection(serializedLedger, 'credit'),
    },
    allocations: serializedAllocations,
    sourceCreditNotes: serializedCredits,
    ledgerEntries: serializedLedger,
  };
}

module.exports = {
  getPaymentAudit,
  getInvoiceAudit,
};
