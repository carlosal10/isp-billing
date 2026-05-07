'use strict';

const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Customer = require('../models/customers');
const Plan = require('../models/plan');
const CreditNote = require('../models/CreditNote');
const InvoiceAllocation = require('../models/InvoiceAllocation');
const BillingLedgerEntry = require('../models/BillingLedgerEntry');
const { createLedgerBatch, reverseLedgerBatch } = require('./billingLedgerService');
const {
  roundCurrency,
  clampPositive,
  addDays,
  diffDays,
  servicePeriodFromExpiry,
  computeInvoiceStatus,
  allocateAmountOldestFirst,
  computeProrationDelta,
  agingBucket,
  computeDunningStage,
} = require('./billingMath');
const {
  resolvePlanDurationDays,
  resolveEntitlementAnchor,
} = require('./paymentEntitlementService');
const { syncCustomerAccessFromPayments } = require('./customerAccessService');
const { initiateSTKPush } = require('../utils/mpesa');

const OPEN_INVOICE_STATUSES = ['issued', 'partially_paid', 'overdue'];
const SETTLED_PAYMENT_STATUSES = new Set(['Success', 'Validated']);

function toObjectIdString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}

function safeDate(value, fallback = new Date()) {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
}

function paymentActorLabel(actor) {
  return actor?.id || actor?.email || actor?.name || null;
}

function nextSequenceId(prefix) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${stamp}-${random}`;
}

async function ensureInvoiceNumber(invoice) {
  if (invoice.invoiceNumber) return invoice.invoiceNumber;
  invoice.invoiceNumber = nextSequenceId('INV');
  await invoice.save();
  return invoice.invoiceNumber;
}

async function ensureCreditNoteNumber(creditNote) {
  if (creditNote.creditNoteNumber) return creditNote.creditNoteNumber;
  creditNote.creditNoteNumber = nextSequenceId('CRN');
  await creditNote.save();
  return creditNote.creditNoteNumber;
}

async function findPlan(planRef, tenantId = null) {
  if (!planRef) return null;
  if (typeof planRef === 'object' && planRef._id) return planRef;
  const filter = { _id: planRef };
  if (tenantId) filter.tenantId = tenantId;
  return Plan.findOne(filter);
}

async function findCustomer(customerRef, tenantId = null) {
  if (!customerRef) return null;
  if (typeof customerRef === 'object' && customerRef._id) return customerRef;
  const filter = { _id: customerRef };
  if (tenantId) filter.tenantId = tenantId;
  return Customer.findOne(filter);
}

async function loadPaymentForFinance(paymentId) {
  return Payment.findById(paymentId)
    .populate('customer')
    .populate('plan')
    .populate('invoice');
}

async function ensureInvoiceLedger(invoice) {
  const existing = await BillingLedgerEntry.findOne({
    tenantId: invoice.tenantId,
    sourceType: 'invoice',
    sourceId: invoice._id,
    reversedAt: null,
  }).lean();
  if (existing || roundCurrency(invoice.total) <= 0) {
    return existing || null;
  }

  return createLedgerBatch({
    tenantId: invoice.tenantId,
    batchId: `invoice:${invoice._id}:issued`,
    sourceType: 'invoice',
    sourceId: invoice._id,
    customerId: invoice.customer,
    invoiceId: invoice._id,
    description: `Invoice ${invoice.invoiceNumber || invoice._id}`,
    effectiveAt: invoice.issueDate || invoice.createdAt || new Date(),
    currency: invoice.currency || 'KES',
    entries: [
      {
        account: 'accounts_receivable',
        direction: 'debit',
        amount: invoice.total,
        invoiceId: invoice._id,
      },
      {
        account: 'subscription_revenue',
        direction: 'credit',
        amount: invoice.total,
        invoiceId: invoice._id,
      },
    ],
  });
}

async function recalculateInvoice(invoiceId) {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) return null;

  const allocations = await InvoiceAllocation.aggregate([
    {
      $match: {
        invoice: invoice._id,
        status: 'applied',
      },
    },
    {
      $group: {
        _id: '$sourceType',
        total: { $sum: '$amount' },
      },
    },
  ]);

  const paid = allocations.find((row) => row._id === 'payment')?.total || 0;
  const credited = allocations.find((row) => row._id === 'credit-note')?.total || 0;
  invoice.amountPaid = roundCurrency(paid);
  invoice.amountCredited = roundCurrency(credited);
  invoice.balanceDue = clampPositive(invoice.total - invoice.amountPaid - invoice.amountCredited);
  invoice.status = computeInvoiceStatus({
    total: invoice.total,
    amountPaid: invoice.amountPaid,
    amountCredited: invoice.amountCredited,
    dueDate: invoice.dueDate,
    explicitStatus: invoice.status === 'voided' ? 'voided' : null,
  });
  await invoice.save();
  return invoice;
}

async function recalculateCreditNote(creditNoteId) {
  const creditNote = await CreditNote.findById(creditNoteId);
  if (!creditNote) return null;
  if (creditNote.status === 'reversed') return creditNote;

  const applied = await InvoiceAllocation.aggregate([
    {
      $match: {
        creditNote: creditNote._id,
        sourceType: 'credit-note',
        status: 'applied',
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amount' },
      },
    },
  ]);
  const appliedTotal = roundCurrency(applied[0]?.total || 0);
  creditNote.remainingAmount = clampPositive(creditNote.amount - appliedTotal);
  if (creditNote.remainingAmount <= 0) {
    creditNote.status = 'applied';
    creditNote.appliedAt = creditNote.appliedAt || new Date();
  } else if (appliedTotal > 0) {
    creditNote.status = 'partially_applied';
  } else {
    creditNote.status = 'open';
  }
  await creditNote.save();
  return creditNote;
}

async function reverseLedgerForSource({ tenantId, filter, reason }) {
  const rows = await BillingLedgerEntry.find({
    tenantId,
    reversedAt: null,
    ...filter,
  })
    .select({ batchId: 1 })
    .lean();
  const batchIds = [...new Set(rows.map((row) => row.batchId).filter(Boolean))];
  for (const batchId of batchIds) {
    await reverseLedgerBatch({
      tenantId,
      batchId,
      reversalBatchId: `reversal:${batchId}:${Date.now()}`,
      description: reason || `Reversal of ${batchId}`,
      metadata: {
        reason: reason || null,
      },
    });
  }
  return batchIds;
}

async function reverseCreditNoteSettlement(creditNote, reason = null) {
  if (!creditNote || creditNote.status === 'reversed') return null;

  const allocations = await InvoiceAllocation.find({
    creditNote: creditNote._id,
    sourceType: 'credit-note',
    status: 'applied',
  });
  const touchedInvoices = new Set();

  for (const allocation of allocations) {
    allocation.status = 'reversed';
    allocation.reversedAt = new Date();
    allocation.reversalReason = reason || 'Credit note reversed';
    await allocation.save();
    touchedInvoices.add(toObjectIdString(allocation.invoice));
  }

  await reverseLedgerForSource({
    tenantId: creditNote.tenantId,
    filter: { creditNote: creditNote._id },
    reason: reason || 'Credit note reversed',
  });

  creditNote.status = 'reversed';
  creditNote.remainingAmount = 0;
  creditNote.reversedAt = new Date();
  creditNote.reversedReason = reason || 'Credit note reversed';
  await creditNote.save();

  for (const invoiceId of touchedInvoices) {
    await recalculateInvoice(invoiceId);
  }

  return creditNote;
}

async function reversePaymentFinancials(payment, reason = null) {
  if (!payment?._id) return null;
  const allocations = await InvoiceAllocation.find({
    payment: payment._id,
    sourceType: 'payment',
    status: 'applied',
  });
  const touchedInvoices = new Set();
  for (const allocation of allocations) {
    allocation.status = 'reversed';
    allocation.reversedAt = new Date();
    allocation.reversalReason = reason || 'Payment reversed';
    await allocation.save();
    touchedInvoices.add(toObjectIdString(allocation.invoice));
  }

  const creditNotes = await CreditNote.find({
    sourcePayment: payment._id,
    status: { $ne: 'reversed' },
  });
  for (const creditNote of creditNotes) {
    await reverseCreditNoteSettlement(creditNote, reason || 'Payment reversed');
  }

  await reverseLedgerForSource({
    tenantId: payment.tenantId,
    filter: { payment: payment._id },
    reason: reason || 'Payment reversed',
  });

  payment.allocatedAmount = 0;
  payment.unappliedAmount = 0;
  payment.isFinanciallyApplied = false;
  payment.financialAppliedAt = null;
  payment.financeVersion = Number(payment.financeVersion || 0) + 1;
  await payment.save();

  for (const invoiceId of touchedInvoices) {
    await recalculateInvoice(invoiceId);
  }

  return payment;
}

async function applyCreditNoteToInvoices(creditNote, openInvoices) {
  if (!creditNote || creditNote.status === 'reversed') {
    return { appliedTotal: 0, allocations: [] };
  }
  const candidates = openInvoices
    .filter((invoice) => OPEN_INVOICE_STATUSES.includes(invoice.status))
    .map((invoice) => ({
      itemId: toObjectIdString(invoice._id),
      outstanding: roundCurrency(invoice.balanceDue),
      invoice,
    }));
  const allocationPlan = allocateAmountOldestFirst(candidates, creditNote.remainingAmount);
  if (allocationPlan.appliedTotal <= 0) {
    return allocationPlan;
  }

  const batchId = `credit-apply:${creditNote._id}:${Date.now()}`;

  const docs = allocationPlan.allocations.map((allocation) => ({
    tenantId: creditNote.tenantId,
    customer: creditNote.customer,
    invoice: allocation.itemId,
    creditNote: creditNote._id,
    sourceType: 'credit-note',
    amount: allocation.amount,
    currency: creditNote.currency || 'KES',
    note: creditNote.reason || null,
    batchId,
  }));

  await InvoiceAllocation.insertMany(docs, { ordered: true });

  await createLedgerBatch({
    tenantId: creditNote.tenantId,
    batchId,
    sourceType: 'credit-application',
    sourceId: creditNote._id,
    customerId: creditNote.customer,
    creditNoteId: creditNote._id,
    description: `Apply credit note ${creditNote.creditNoteNumber || creditNote._id}`,
    effectiveAt: new Date(),
    currency: creditNote.currency || 'KES',
    entries: [
      {
        account: 'customer_credits',
        direction: 'debit',
        amount: allocationPlan.appliedTotal,
        creditNoteId: creditNote._id,
      },
      ...allocationPlan.allocations.map((allocation) => ({
        account: 'accounts_receivable',
        direction: 'credit',
        amount: allocation.amount,
        invoiceId: allocation.itemId,
        creditNoteId: creditNote._id,
      })),
    ],
  });

  await recalculateCreditNote(creditNote._id);
  for (const allocation of allocationPlan.allocations) {
    await recalculateInvoice(allocation.itemId);
  }

  return allocationPlan;
}

async function applyAvailableCredits({ tenantId, customerId }) {
  const openCredits = await CreditNote.find({
    tenantId,
    customer: customerId,
    status: { $in: ['open', 'partially_applied'] },
  }).sort({ issuedAt: 1, createdAt: 1 });

  if (openCredits.length === 0) {
    return { appliedTotal: 0, creditNotesTouched: 0 };
  }

  let appliedTotal = 0;
  let creditNotesTouched = 0;

  for (const creditNote of openCredits) {
    const invoices = await Invoice.find({
      tenantId,
      customer: customerId,
      status: { $in: OPEN_INVOICE_STATUSES },
    }).sort({ dueDate: 1, createdAt: 1 });

    if (invoices.length === 0) break;
    const result = await applyCreditNoteToInvoices(creditNote, invoices);
    if (result.appliedTotal > 0) {
      appliedTotal += result.appliedTotal;
      creditNotesTouched += 1;
    }
  }

  return {
    appliedTotal: roundCurrency(appliedTotal),
    creditNotesTouched,
  };
}

async function buildInvoiceDraft({
  tenantId,
  customer,
  plan,
  total,
  issueDate = new Date(),
  dueDate = issueDate,
  servicePeriodStart = null,
  servicePeriodEnd = null,
  billingReason = 'manual',
  sourcePayment = null,
  lineItems = [],
  metadata = {},
}) {
  const invoice = new Invoice({
    tenantId,
    customer: customer._id || customer,
    plan: plan._id || plan,
    sourcePayment: sourcePayment || null,
    issueDate,
    dueDate,
    servicePeriodStart,
    servicePeriodEnd,
    generated: true,
    generatedAt: new Date(),
    status: 'issued',
    billingReason,
    lineItems:
      Array.isArray(lineItems) && lineItems.length > 0
        ? lineItems
        : [
            {
              description: `${plan.name || 'Plan'} charge`,
              kind: 'service',
              quantity: 1,
              unitPrice: total,
              amount: total,
            },
          ],
    total,
    subtotal: total,
    currency: 'KES',
    autopayEnabled: customer?.billingProfile?.autopayEnabled === true,
    autopayStatus:
      customer?.billingProfile?.autopayEnabled === true
        ? 'eligible'
        : 'not-applicable',
    dunningStage: computeDunningStage({
      dueDate,
      graceDays: customer?.billingProfile?.graceDays ?? 3,
      currentDate: new Date(),
    }),
    metadata,
  });
  await invoice.save();
  await ensureInvoiceNumber(invoice);
  await ensureInvoiceLedger(invoice);
  await recalculateInvoice(invoice._id);
  return invoice;
}

async function ensureRenewalInvoiceForPayment(payment) {
  let invoice = null;
  if (payment.invoice) {
    invoice = payment.invoice;
  } else {
    invoice = await Invoice.findOne({ sourcePayment: payment._id, tenantId: payment.tenantId });
    if (!invoice) {
      invoice = await Invoice.findOne({
        tenantId: payment.tenantId,
        customer: payment.customer?._id || payment.customer,
        plan: payment.plan?._id || payment.plan,
        status: { $in: OPEN_INVOICE_STATUSES },
      }).sort({ dueDate: 1, createdAt: 1 });
    }
  }
  if (invoice) {
    if (!payment.invoice || toObjectIdString(payment.invoice) !== toObjectIdString(invoice._id)) {
      payment.invoice = invoice._id;
      await payment.save();
    }
    await ensureInvoiceNumber(invoice);
    await ensureInvoiceLedger(invoice);
    return invoice;
  }

  const customer = await findCustomer(payment.customer, payment.tenantId);
  const plan = await findPlan(payment.plan, payment.tenantId);
  if (!customer || !plan) return null;

  const price = roundCurrency(plan.price || payment.amount || 0);
  const durationDays = resolvePlanDurationDays(plan);
  const issueDate = safeDate(payment.validatedAt || payment.createdAt || new Date());
  const serviceWindow = payment.expiryDate
    ? servicePeriodFromExpiry(payment.expiryDate, durationDays)
    : {
        servicePeriodStart: issueDate,
        servicePeriodEnd: addDays(issueDate, durationDays || 0),
      };

  invoice = await buildInvoiceDraft({
    tenantId: payment.tenantId,
    customer,
    plan,
    total: price,
    issueDate,
    dueDate: issueDate,
    servicePeriodStart: serviceWindow.servicePeriodStart,
    servicePeriodEnd: serviceWindow.servicePeriodEnd,
    billingReason: 'renewal',
    sourcePayment: payment._id,
    lineItems: [
      {
        description: `${plan.name || 'Plan'} renewal`,
        kind: 'service',
        quantity: 1,
        unitPrice: price,
        amount: price,
      },
    ],
    metadata: {
      createdFromPaymentId: String(payment._id),
    },
  });

  payment.invoice = invoice._id;
  await payment.save();
  return invoice;
}

async function issueInvoiceForPlan({
  tenantId,
  customerId,
  planId,
  total = null,
  issueDate = new Date(),
  dueDate = new Date(),
  servicePeriodStart = null,
  servicePeriodEnd = null,
  billingReason = 'manual',
  lineItems = [],
  metadata = {},
}) {
  const customer = await findCustomer(customerId, tenantId);
  const plan = await findPlan(planId, tenantId);
  if (!customer || !plan) {
    throw new Error('Customer or plan not found');
  }

  const invoice = await buildInvoiceDraft({
    tenantId,
    customer,
    plan,
    total: roundCurrency(total == null ? plan.price || 0 : total),
    issueDate,
    dueDate,
    servicePeriodStart,
    servicePeriodEnd,
    billingReason,
    lineItems,
    metadata,
  });
  await applyAvailableCredits({ tenantId, customerId: customer._id });
  return Invoice.findById(invoice._id)
    .populate('customer', 'name accountNumber email phone')
    .populate('plan', 'name price duration');
}

async function ensureCollectableInvoiceForPaymentStart({
  tenantId,
  customerId,
  planId,
  issueDate = new Date(),
}) {
  const existing = await Invoice.findOne({
    tenantId,
    customer: customerId,
    plan: planId,
    status: { $in: OPEN_INVOICE_STATUSES },
  }).sort({ dueDate: 1, createdAt: 1 });
  if (existing) return existing;

  const customer = await findCustomer(customerId, tenantId);
  const plan = await findPlan(planId, tenantId);
  if (!customer || !plan) return null;

  const durationDays = resolvePlanDurationDays(plan);
  const anchor = resolveEntitlementAnchor({
    customerExpiryDate: customer.expiryDate || null,
    referenceDate: issueDate,
  });
  const servicePeriodStart = safeDate(anchor, issueDate);
  const servicePeriodEnd = durationDays > 0 ? addDays(servicePeriodStart, durationDays) : null;

  return buildInvoiceDraft({
    tenantId,
    customer,
    plan,
    total: roundCurrency(plan.price || 0),
    issueDate,
    dueDate: issueDate,
    servicePeriodStart,
    servicePeriodEnd,
    billingReason: 'renewal',
    lineItems: [
      {
        description: `${plan.name || 'Plan'} renewal`,
        kind: 'service',
        quantity: 1,
        unitPrice: roundCurrency(plan.price || 0),
        amount: roundCurrency(plan.price || 0),
      },
    ],
    metadata: {
      createdBy: 'payment-start',
    },
  });
}

async function settlePaymentFinancials(payment) {
  const paymentTotal = roundCurrency(payment.amount || 0);
  if (paymentTotal <= 0) {
    payment.allocatedAmount = 0;
    payment.unappliedAmount = 0;
    payment.isFinanciallyApplied = false;
    payment.financialAppliedAt = null;
    await payment.save();
    return payment;
  }

  const invoice = await ensureRenewalInvoiceForPayment(payment);
  if (invoice) {
    await applyAvailableCredits({
      tenantId: payment.tenantId,
      customerId: toObjectIdString(payment.customer),
    });
    await recalculateInvoice(invoice._id);
  }

  const openInvoices = await Invoice.find({
    tenantId: payment.tenantId,
    customer: payment.customer?._id || payment.customer,
    status: { $in: OPEN_INVOICE_STATUSES },
  }).sort({ dueDate: 1, createdAt: 1 });

  const ordered = [];
  const primaryId = toObjectIdString(payment.invoice || invoice?._id || null);
  if (primaryId) {
    const primary = openInvoices.find((row) => toObjectIdString(row._id) === primaryId);
    if (primary) ordered.push(primary);
  }
  for (const row of openInvoices) {
    if (toObjectIdString(row._id) !== primaryId) ordered.push(row);
  }

  const allocationPlan = allocateAmountOldestFirst(
    ordered.map((item) => ({
      itemId: toObjectIdString(item._id),
      outstanding: roundCurrency(item.balanceDue),
      item,
    })),
    paymentTotal
  );

  const batchId = `payment:${payment._id}:v${Number(payment.financeVersion || 0) + 1}`;
  const docs = allocationPlan.allocations.map((allocation) => ({
    tenantId: payment.tenantId,
    customer: payment.customer?._id || payment.customer,
    invoice: allocation.itemId,
    payment: payment._id,
    sourceType: 'payment',
    amount: allocation.amount,
    currency: payment.currency || 'KES',
    note: payment.notes || null,
    batchId,
  }));
  if (docs.length > 0) {
    await InvoiceAllocation.insertMany(docs, { ordered: true });
  }

  let creditNote = null;
  if (allocationPlan.remaining > 0) {
    creditNote = await CreditNote.create({
      tenantId: payment.tenantId,
      customer: payment.customer?._id || payment.customer,
      sourcePayment: payment._id,
      sourceInvoice: payment.invoice?._id || payment.invoice || invoice?._id || null,
      amount: allocationPlan.remaining,
      remainingAmount: allocationPlan.remaining,
      reason: 'Unapplied payment credit',
      metadata: {
        createdFromPaymentId: String(payment._id),
      },
    });
    await ensureCreditNoteNumber(creditNote);
  }

  const ledgerEntries = [
    {
      account: 'cash',
      direction: 'debit',
      amount: paymentTotal,
      paymentId: payment._id,
    },
    ...allocationPlan.allocations.map((allocation) => ({
      account: 'accounts_receivable',
      direction: 'credit',
      amount: allocation.amount,
      invoiceId: allocation.itemId,
      paymentId: payment._id,
    })),
  ];
  if (creditNote && allocationPlan.remaining > 0) {
    ledgerEntries.push({
      account: 'customer_credits',
      direction: 'credit',
      amount: allocationPlan.remaining,
      creditNoteId: creditNote._id,
      paymentId: payment._id,
    });
  }
  await createLedgerBatch({
    tenantId: payment.tenantId,
    batchId,
    sourceType: 'payment',
    sourceId: payment._id,
    customerId: payment.customer?._id || payment.customer,
    paymentId: payment._id,
    description: `Settlement for payment ${payment.transactionId || payment._id}`,
    effectiveAt: payment.validatedAt || payment.createdAt || new Date(),
    currency: payment.currency || 'KES',
    entries: ledgerEntries,
  });

  for (const allocation of allocationPlan.allocations) {
    await recalculateInvoice(allocation.itemId);
  }
  if (creditNote) {
    await recalculateCreditNote(creditNote._id);
  }

  payment.allocatedAmount = allocationPlan.appliedTotal;
  payment.unappliedAmount = allocationPlan.remaining;
  payment.isFinanciallyApplied = true;
  payment.financialAppliedAt = new Date();
  payment.financeVersion = Number(payment.financeVersion || 0) + 1;
  await payment.save();
  return payment;
}

async function syncPaymentFinancials({ paymentId, actor = null, reason = null }) {
  const payment = await loadPaymentForFinance(paymentId);
  if (!payment) return null;

  await reversePaymentFinancials(payment, reason || 'Payment financial sync');
  if (!SETTLED_PAYMENT_STATUSES.has(String(payment.status || '')) || payment.isDeleted) {
    return loadPaymentForFinance(paymentId);
  }

  await settlePaymentFinancials(payment);
  return loadPaymentForFinance(paymentId);
}

async function markInvoicePaidManually({ tenantId, invoiceId, actor = null, note = null }) {
  let invoice = await Invoice.findOne({ _id: invoiceId, tenantId }).populate('customer plan');
  if (!invoice) {
    const err = new Error('Invoice not found');
    err.statusCode = 404;
    throw err;
  }

  await recalculateInvoice(invoice._id);
  invoice = await Invoice.findById(invoice._id).populate('customer plan');
  if (invoice.balanceDue <= 0) {
    return { invoice, payment: null };
  }

  const payment = await Payment.create({
    tenantId,
    accountNumber: invoice.customer?.accountNumber || 'N/A',
    phoneNumber: invoice.customer?.phone || undefined,
    customer: invoice.customer?._id || invoice.customer,
    invoice: invoice._id,
    plan: invoice.plan?._id || invoice.plan,
    amount: invoice.balanceDue,
    method: 'manual',
    status: 'Validated',
    transactionId: `${invoice.invoiceNumber || invoice._id}-MANUAL-${Date.now()}`,
    validatedBy: paymentActorLabel(actor) || 'invoice-settlement',
    validatedAt: new Date(),
    notes: note || 'Manual invoice settlement',
  });

  await syncPaymentFinancials({
    paymentId: payment._id,
    actor,
    reason: 'Manual invoice settlement',
  });
  await syncCustomerAccessFromPayments({
    tenantId,
    customerId: invoice.customer?._id || invoice.customer,
    debugId: `invoice-manual-${String(payment._id)}`,
  }).catch(() => {});

  return {
    invoice: await Invoice.findById(invoice._id).populate('customer plan'),
    payment: await Payment.findById(payment._id).populate('customer plan invoice'),
  };
}

async function ensureInvoiceGenerated({ tenantId, invoiceId }) {
  const invoice = await Invoice.findOne({ _id: invoiceId, tenantId });
  if (!invoice) {
    const err = new Error('Invoice not found');
    err.statusCode = 404;
    throw err;
  }
  invoice.generated = true;
  invoice.generatedAt = invoice.generatedAt || new Date();
  await ensureInvoiceNumber(invoice);
  await ensureInvoiceLedger(invoice);
  await recalculateInvoice(invoice._id);
  return Invoice.findById(invoice._id).populate('customer plan');
}

function renderInvoiceHtml(invoice) {
  const rows = (invoice.lineItems || [])
    .map(
      (item) => `
        <tr>
          <td>${item.description || ''}</td>
          <td>${item.quantity || 0}</td>
          <td>${roundCurrency(item.unitPrice || 0).toFixed(2)}</td>
          <td>${roundCurrency(item.amount || 0).toFixed(2)}</td>
        </tr>`
    )
    .join('');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Invoice ${invoice.invoiceNumber || invoice._id}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 24px; color: #16202a; }
      h1 { margin-bottom: 4px; }
      .meta { margin-bottom: 24px; color: #475569; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      th, td { border: 1px solid #d7dee7; padding: 10px; text-align: left; }
      th { background: #f5f7fb; }
      .totals { margin-top: 24px; width: 320px; margin-left: auto; }
      .totals td { border: none; padding: 6px 0; }
      .pill { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #e8eef7; }
    </style>
  </head>
  <body>
    <h1>Invoice ${invoice.invoiceNumber || invoice._id}</h1>
    <div class="meta">
      <div>Customer: ${invoice.customer?.name || '-'}</div>
      <div>Account: ${invoice.customer?.accountNumber || '-'}</div>
      <div>Status: <span class="pill">${invoice.status || '-'}</span></div>
      <div>Issued: ${invoice.issueDate ? new Date(invoice.issueDate).toLocaleString() : '-'}</div>
      <div>Due: ${invoice.dueDate ? new Date(invoice.dueDate).toLocaleString() : '-'}</div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th>Qty</th>
          <th>Unit Price</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="totals">
      <tr><td>Subtotal</td><td>${roundCurrency(invoice.subtotal || 0).toFixed(2)}</td></tr>
      <tr><td>Discount</td><td>${roundCurrency(invoice.discountTotal || 0).toFixed(2)}</td></tr>
      <tr><td>Tax</td><td>${roundCurrency(invoice.taxTotal || 0).toFixed(2)}</td></tr>
      <tr><td>Total</td><td>${roundCurrency(invoice.total || 0).toFixed(2)}</td></tr>
      <tr><td>Paid</td><td>${roundCurrency(invoice.amountPaid || 0).toFixed(2)}</td></tr>
      <tr><td>Credited</td><td>${roundCurrency(invoice.amountCredited || 0).toFixed(2)}</td></tr>
      <tr><td><strong>Balance Due</strong></td><td><strong>${roundCurrency(invoice.balanceDue || 0).toFixed(2)}</strong></td></tr>
    </table>
  </body>
</html>`;
}

async function createProrationAdjustmentForPlanChange({
  tenantId,
  customerId,
  oldPlanId,
  newPlanId,
  currentExpiryDate = null,
}) {
  if (!oldPlanId || !newPlanId || String(oldPlanId) === String(newPlanId)) {
    return null;
  }

  const [customer, oldPlan, newPlan] = await Promise.all([
    findCustomer(customerId, tenantId),
    findPlan(oldPlanId, tenantId),
    findPlan(newPlanId, tenantId),
  ]);
  if (!customer || !oldPlan || !newPlan || !currentExpiryDate) return null;

  const remainingDays = Math.max(0, diffDays(currentExpiryDate, new Date()));
  if (remainingDays <= 0) return null;

  const delta = computeProrationDelta({
    oldPrice: oldPlan.price,
    oldDurationDays: resolvePlanDurationDays(oldPlan),
    newPrice: newPlan.price,
    newDurationDays: resolvePlanDurationDays(newPlan),
    remainingDays,
  });

  if (Math.abs(delta) < 0.01) return null;

  if (delta > 0) {
    return issueInvoiceForPlan({
      tenantId,
      customerId: customer._id,
      planId: newPlan._id,
      total: delta,
      issueDate: new Date(),
      dueDate: new Date(),
      servicePeriodStart: new Date(),
      servicePeriodEnd: currentExpiryDate,
      billingReason: 'proration',
      lineItems: [
        {
          description: `Proration upgrade adjustment (${remainingDays} day(s))`,
          kind: 'proration',
          quantity: 1,
          unitPrice: delta,
          amount: delta,
        },
      ],
      metadata: {
        oldPlanId: String(oldPlan._id),
        newPlanId: String(newPlan._id),
        remainingDays,
      },
    });
  }

  const creditNote = await CreditNote.create({
    tenantId,
    customer: customer._id,
    sourceInvoice: null,
    amount: Math.abs(delta),
    remainingAmount: Math.abs(delta),
    reason: `Proration downgrade credit (${remainingDays} day(s))`,
    metadata: {
      oldPlanId: String(oldPlan._id),
      newPlanId: String(newPlan._id),
      remainingDays,
    },
  });
  await ensureCreditNoteNumber(creditNote);
  await createLedgerBatch({
    tenantId,
    batchId: `credit-note:${creditNote._id}:issue`,
    sourceType: 'credit-note',
    sourceId: creditNote._id,
    customerId: customer._id,
    creditNoteId: creditNote._id,
    description: creditNote.reason,
    entries: [
      {
        account: 'subscription_revenue_adjustments',
        direction: 'debit',
        amount: creditNote.amount,
        creditNoteId: creditNote._id,
      },
      {
        account: 'customer_credits',
        direction: 'credit',
        amount: creditNote.amount,
        creditNoteId: creditNote._id,
      },
    ],
  });
  await applyAvailableCredits({ tenantId, customerId: customer._id });
  return creditNote;
}

async function reversePaymentStatus({
  tenantId,
  paymentId,
  actor = null,
  reason = null,
  nextStatus = 'Reversed',
}) {
  const payment = await loadPaymentForFinance(paymentId);
  if (!payment || String(payment.tenantId) !== String(tenantId)) {
    const err = new Error('Payment not found');
    err.statusCode = 404;
    throw err;
  }

  await reversePaymentFinancials(payment, reason || nextStatus);
  payment.status = nextStatus;
  if (nextStatus === 'Refunded') {
    payment.refundAmount = payment.amount;
    payment.refundedAt = new Date();
    payment.refundedBy = paymentActorLabel(actor) || 'system';
    payment.refundReason = reason || 'Refunded';
  } else if (nextStatus === 'Chargeback') {
    payment.chargebackAmount = payment.amount;
    payment.chargedBackAt = new Date();
    payment.chargebackReason = reason || 'Chargeback';
  } else {
    payment.reversedAt = new Date();
    payment.reversedBy = paymentActorLabel(actor) || 'system';
    payment.reversalReason = reason || 'Reversed';
  }
  await payment.save();
  await syncCustomerAccessFromPayments({
    tenantId,
    customerId: payment.customer?._id || payment.customer,
    debugId: `payment-status-${String(payment._id)}`,
  }).catch(() => {});
  return payment;
}

async function processRecurringInvoices(now = new Date()) {
  const customers = await Customer.find({
    plan: { $ne: null },
    status: { $ne: 'archived' },
  }).lean();

  let created = 0;
  let skipped = 0;

  for (const customer of customers) {
    const plan = await Plan.findById(customer.plan).lean();
    if (!plan) {
      skipped += 1;
      continue;
    }
    const leadDays = Number(customer?.billingProfile?.invoiceLeadDays ?? 3);
    const expiry = customer.expiryDate ? new Date(customer.expiryDate) : null;
    const daysUntilExpiry = expiry ? diffDays(expiry, now) : 0;
    if (expiry && daysUntilExpiry > leadDays) {
      skipped += 1;
      continue;
    }

    const openInvoice = await Invoice.findOne({
      tenantId: customer.tenantId,
      customer: customer._id,
      plan: plan._id,
      billingReason: 'renewal',
      status: { $in: OPEN_INVOICE_STATUSES },
    }).lean();
    if (openInvoice) {
      skipped += 1;
      continue;
    }

    const durationDays = resolvePlanDurationDays(plan);
    const servicePeriodStart = expiry && expiry.getTime() > now.getTime() ? expiry : now;
    const servicePeriodEnd = durationDays > 0 ? addDays(servicePeriodStart, durationDays) : null;

    await issueInvoiceForPlan({
      tenantId: customer.tenantId,
      customerId: customer._id,
      planId: plan._id,
      total: roundCurrency(plan.price || 0),
      issueDate: now,
      dueDate: expiry || now,
      servicePeriodStart,
      servicePeriodEnd,
      billingReason: 'renewal',
      lineItems: [
        {
          description: `${plan.name || 'Plan'} recurring renewal`,
          kind: 'service',
          quantity: 1,
          unitPrice: roundCurrency(plan.price || 0),
          amount: roundCurrency(plan.price || 0),
        },
      ],
      metadata: {
        recurring: true,
      },
    });
    created += 1;
  }

  return { created, skipped };
}

async function attemptInvoiceAutopay(invoice, now = new Date()) {
  const customer = await Customer.findById(invoice.customer).lean();
  const plan = await Plan.findById(invoice.plan).lean();
  if (!customer || !plan) {
    invoice.autopayStatus = 'failed';
    invoice.lastAutopayError = 'Customer or plan missing';
    await invoice.save();
    return { attempted: false, reason: 'missing-customer-or-plan' };
  }
  if (customer?.billingProfile?.autopayEnabled !== true) {
    invoice.autopayStatus = 'disabled';
    await invoice.save();
    return { attempted: false, reason: 'autopay-disabled' };
  }

  const method = String(customer?.billingProfile?.preferredPaymentMethod || 'mpesa').toLowerCase();
  if (method !== 'mpesa') {
    invoice.autopayStatus = 'failed';
    invoice.lastAutopayError = `Unsupported autopay method: ${method}`;
    await invoice.save();
    return { attempted: false, reason: 'unsupported-method' };
  }

  const phone = customer?.billingProfile?.preferredPhoneNumber || customer.phone || null;
  if (!phone) {
    invoice.autopayStatus = 'failed';
    invoice.lastAutopayError = 'No phone available for M-Pesa autopay';
    await invoice.save();
    return { attempted: false, reason: 'missing-phone' };
  }

  const payment = await Payment.create({
    tenantId: invoice.tenantId,
    accountNumber: customer.accountNumber || 'N/A',
    phoneNumber: phone,
    customer: customer._id,
    invoice: invoice._id,
    plan: plan._id,
    amount: roundCurrency(invoice.balanceDue),
    method: 'mpesa',
    status: 'Pending',
    notes: `Autopay retry for ${invoice.invoiceNumber || invoice._id}`,
  });

  const apiBase = process.env.VITE_API_URL || '';
  const serverBase = apiBase.replace(/\/?api\/?$/, '');
  const callbackURL =
    process.env.MPESA_CALLBACK_URL ||
    `${serverBase}/api/payment/callback/callback`;

  try {
    const stkResponse = await initiateSTKPush({
      ispId: invoice.tenantId,
      amount: payment.amount,
      phone,
      accountReference: customer.accountNumber,
      callbackURL,
    });
    payment.checkoutRequestId = stkResponse?.CheckoutRequestID || null;
    payment.merchantRequestId = stkResponse?.MerchantRequestID || null;
    await payment.save();
    invoice.autopayStatus = 'pending';
    invoice.lastAutopayError = null;
  } catch (err) {
    payment.status = 'Failed';
    payment.notes = `${payment.notes || ''} | ${err?.message || 'Autopay failed'}`.trim();
    await payment.save();
    invoice.autopayStatus = 'failed';
    invoice.lastAutopayError = err?.message || 'Autopay failed';
  }

  invoice.lastAutopayAttemptAt = now;
  invoice.autopayAttemptCount = Number(invoice.autopayAttemptCount || 0) + 1;
  await invoice.save();
  return { attempted: true, paymentId: payment._id };
}

async function processCollections(now = new Date()) {
  const invoices = await Invoice.find({
    status: { $in: OPEN_INVOICE_STATUSES },
  });

  let updated = 0;
  let autopayAttempts = 0;

  for (const invoice of invoices) {
    await recalculateInvoice(invoice._id);
    const refreshed = await Invoice.findById(invoice._id);
    if (!refreshed) continue;

    const customer = await Customer.findById(refreshed.customer).lean();
    const graceDays = customer?.billingProfile?.graceDays ?? 3;
    refreshed.dunningStage = computeDunningStage({
      dueDate: refreshed.dueDate,
      graceDays,
      currentDate: now,
    });
    if (refreshed.status === 'issued' && refreshed.dueDate && refreshed.dueDate.getTime() < now.getTime()) {
      refreshed.status = 'overdue';
    }

    const retryIntervalDays = Math.max(1, Number(customer?.billingProfile?.retryIntervalDays ?? 2));
    const maxAttempts = Math.max(0, Number(customer?.billingProfile?.maxAutopayAttempts ?? 3));
    const retryDue =
      refreshed.autopayEnabled &&
      refreshed.balanceDue > 0 &&
      Number(refreshed.autopayAttemptCount || 0) < maxAttempts &&
      (!refreshed.nextAutopayRetryAt || safeDate(refreshed.nextAutopayRetryAt).getTime() <= now.getTime());

    if (retryDue) {
      const result = await attemptInvoiceAutopay(refreshed, now);
      if (result.attempted) {
        autopayAttempts += 1;
      }
      refreshed.nextAutopayRetryAt = addDays(now, retryIntervalDays);
    }

    refreshed.nextDunningAt = addDays(now, 1);
    refreshed.lastDunningAt = now;
    await refreshed.save();
    updated += 1;
  }

  return { updated, autopayAttempts };
}

module.exports = {
  applyAvailableCredits,
  createProrationAdjustmentForPlanChange,
  ensureCollectableInvoiceForPaymentStart,
  ensureInvoiceGenerated,
  ensureRenewalInvoiceForPayment,
  issueInvoiceForPlan,
  markInvoicePaidManually,
  processCollections,
  processRecurringInvoices,
  recalculateCreditNote,
  recalculateInvoice,
  renderInvoiceHtml,
  reversePaymentStatus,
  syncPaymentFinancials,
  agingBucket,
};
