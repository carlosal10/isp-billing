'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const { computeInvoiceStatus } = require('../services/billingMath');
const {
  ensureInvoiceGenerated,
  syncPaymentFinancials,
} = require('../services/billingFinanceService');

const DRY_RUN = String(process.env.DRY_RUN || '1') !== '0';
const TENANT_ID = String(process.env.TENANT_ID || '').trim() || null;
const LIMIT = Math.max(0, Number(process.env.LIMIT || 0));

function log(message, payload = null) {
  if (payload) {
    console.log(`[finance-backfill] ${message}`, payload);
  } else {
    console.log(`[finance-backfill] ${message}`);
  }
}

function isFiniteMoney(value) {
  return Number.isFinite(Number(value));
}

function roundMoney(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

function coerceLegacyTotal(rawInvoice) {
  if (isFiniteMoney(rawInvoice.total)) return roundMoney(rawInvoice.total);
  if (isFiniteMoney(rawInvoice.amountDue)) return roundMoney(rawInvoice.amountDue);
  if (Array.isArray(rawInvoice.lineItems) && rawInvoice.lineItems.length > 0) {
    return roundMoney(
      rawInvoice.lineItems.reduce((sum, item) => sum + Number(item?.amount || 0), 0)
    );
  }
  return 0;
}

function coerceLegacyAmountPaid(rawInvoice, total) {
  if (isFiniteMoney(rawInvoice.amountPaid)) return roundMoney(rawInvoice.amountPaid);
  if (String(rawInvoice.status || '').toLowerCase() === 'paid') return roundMoney(total);
  return 0;
}

function buildInvoicePatch(rawInvoice) {
  const total = coerceLegacyTotal(rawInvoice);
  const amountPaid = coerceLegacyAmountPaid(rawInvoice, total);
  const amountCredited = isFiniteMoney(rawInvoice.amountCredited)
    ? roundMoney(rawInvoice.amountCredited)
    : 0;
  const dueDate = rawInvoice.dueDate ? new Date(rawInvoice.dueDate) : null;
  const status = computeInvoiceStatus({
    total,
    amountPaid,
    amountCredited,
    dueDate,
    explicitStatus: String(rawInvoice.status || '').toLowerCase() === 'voided' ? 'voided' : null,
  });
  const lineItems =
    Array.isArray(rawInvoice.lineItems) && rawInvoice.lineItems.length > 0
      ? rawInvoice.lineItems
      : [
          {
            description: 'Legacy service charge',
            kind: 'service',
            quantity: 1,
            unitPrice: total,
            amount: total,
          },
        ];
  const issueDate = rawInvoice.issueDate || rawInvoice.generatedAt || rawInvoice.createdAt || new Date();
  const generatedAt = rawInvoice.generatedAt || issueDate;

  return {
    issueDate,
    generatedAt,
    generated: rawInvoice.generated !== false,
    billingReason: rawInvoice.billingReason || 'manual',
    currency: rawInvoice.currency || 'KES',
    subtotal: total,
    discountTotal: isFiniteMoney(rawInvoice.discountTotal) ? roundMoney(rawInvoice.discountTotal) : 0,
    taxTotal: isFiniteMoney(rawInvoice.taxTotal) ? roundMoney(rawInvoice.taxTotal) : 0,
    total,
    amountPaid,
    amountCredited,
    balanceDue: roundMoney(Math.max(0, total - amountPaid - amountCredited)),
    lineItems,
    autopayEnabled: rawInvoice.autopayEnabled === true,
    autopayStatus: rawInvoice.autopayStatus || (rawInvoice.autopayEnabled === true ? 'eligible' : 'not-applicable'),
    dunningStage: rawInvoice.dunningStage || 'none',
    status,
  };
}

async function backfillInvoices() {
  const rawCollection = mongoose.connection.db.collection('invoices');
  const filter = TENANT_ID ? { tenantId: new mongoose.Types.ObjectId(TENANT_ID) } : {};
  const cursor = rawCollection.find(filter).sort({ createdAt: 1 });
  let processed = 0;
  let updated = 0;

  for await (const rawInvoice of cursor) {
    if (LIMIT > 0 && processed >= LIMIT) break;
    processed += 1;
    const patch = buildInvoicePatch(rawInvoice);

    if (!DRY_RUN) {
      await Invoice.updateOne({ _id: rawInvoice._id }, { $set: patch });
      await ensureInvoiceGenerated({
        tenantId: rawInvoice.tenantId,
        invoiceId: rawInvoice._id,
      }).catch((err) => {
        log('invoice generation sync failed', {
          invoiceId: String(rawInvoice._id),
          error: err?.message || err,
        });
      });
    }
    updated += 1;
  }

  return { processed, updated };
}

async function backfillPayments() {
  const filter = TENANT_ID ? { tenantId: new mongoose.Types.ObjectId(TENANT_ID) } : {};
  const payments = await Payment.find(filter)
    .sort({ createdAt: 1 })
    .select({ _id: 1, tenantId: 1, customer: 1, plan: 1, status: 1, isDeleted: 1 })
    .lean();

  let processed = 0;
  let synced = 0;
  let skipped = 0;

  for (const payment of payments) {
    if (LIMIT > 0 && processed >= LIMIT) break;
    processed += 1;

    if (!payment.customer || !payment.plan) {
      skipped += 1;
      continue;
    }

    if (!DRY_RUN) {
      await syncPaymentFinancials({
        paymentId: payment._id,
        actor: { id: 'finance-backfill' },
        reason: 'Finance backfill',
      }).catch((err) => {
        log('payment finance sync failed', {
          paymentId: String(payment._id),
          error: err?.message || err,
        });
      });
    }
    synced += 1;
  }

  return { processed, synced, skipped };
}

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }

  log(`starting (${DRY_RUN ? 'dry-run' : 'write'})`, {
    tenantId: TENANT_ID || 'all',
    limit: LIMIT || 'none',
  });

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });

  const invoiceStats = await backfillInvoices();
  const paymentStats = await backfillPayments();

  log('completed', {
    invoiceStats,
    paymentStats,
    dryRun: DRY_RUN,
  });
}

main()
  .catch((err) => {
    console.error('[finance-backfill] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
