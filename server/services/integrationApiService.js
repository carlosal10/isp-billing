'use strict';

const mongoose = require('mongoose');
const Customer = require('../models/customers');
const Invoice = require('../models/Invoice');
const { serializeCommunicationPreferences } = require('./customerCommunicationPreferencesService');
const { listPayments } = require('./paymentReadService');
const { createSupportTicket } = require('./supportOperationsService');

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function serviceError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function toId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}

function toPlain(doc) {
  if (!doc) return null;
  return typeof doc.toObject === 'function' ? doc.toObject() : doc;
}

function parseIntegrationLimit(value, defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultLimit;
  return Math.min(Math.floor(parsed), maxLimit);
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compactPlan(plan) {
  const doc = toPlain(plan);
  if (!doc) return null;
  return {
    id: toId(doc._id || doc),
    name: doc.name || null,
    price: doc.price ?? null,
    duration: doc.duration ?? null,
    durationDays: doc.durationDays ?? null,
    speed: doc.speed || null,
  };
}

function compactCustomer(customer) {
  const doc = toPlain(customer);
  if (!doc) return null;
  return {
    id: toId(doc._id || doc),
    name: doc.name || null,
    accountNumber: doc.accountNumber || null,
    phone: doc.phone || null,
    email: doc.email || null,
    connectionType: doc.connectionType || null,
  };
}

function serializeIntegrationCustomer(customer) {
  const doc = toPlain(customer);
  if (!doc) return null;

  const billing = doc.billingProfile || {};
  return {
    id: toId(doc._id),
    name: doc.name || null,
    email: doc.email || null,
    phone: doc.phone || null,
    address: doc.address || null,
    accountNumber: doc.accountNumber || null,
    accountAliases: Array.isArray(doc.accountAliases) ? doc.accountAliases : [],
    status: doc.status || null,
    expiryDate: doc.expiryDate || null,
    routerIp: doc.routerIp || null,
    connectionType: doc.connectionType || null,
    plan: compactPlan(doc.plan),
    service: {
      pppoe: doc.connectionType === 'pppoe' ? doc.pppoeConfig || null : null,
      static: doc.connectionType === 'static' ? doc.staticConfig || null : null,
    },
    billingProfile: {
      invoiceLeadDays: billing.invoiceLeadDays ?? null,
      autopayEnabled: billing.autopayEnabled === true,
      preferredPaymentMethod: billing.preferredPaymentMethod || null,
      graceDays: billing.graceDays ?? null,
      retryIntervalDays: billing.retryIntervalDays ?? null,
      maxAutopayAttempts: billing.maxAutopayAttempts ?? null,
    },
    communicationPreferences: serializeCommunicationPreferences(doc),
    portalEnabled: doc.portalProfile?.isEnabled !== false,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

function serializeIntegrationInvoice(invoice) {
  const doc = toPlain(invoice);
  if (!doc) return null;

  return {
    id: toId(doc._id),
    invoiceNumber: doc.invoiceNumber || null,
    documentType: doc.documentType || 'invoice',
    status: doc.status || null,
    currency: doc.currency || 'KES',
    issueDate: doc.issueDate || null,
    dueDate: doc.dueDate || null,
    servicePeriodStart: doc.servicePeriodStart || null,
    servicePeriodEnd: doc.servicePeriodEnd || null,
    billingReason: doc.billingReason || null,
    generated: doc.generated === true,
    generatedAt: doc.generatedAt || null,
    customer: compactCustomer(doc.customer),
    plan: compactPlan(doc.plan),
    lineItems: Array.isArray(doc.lineItems)
      ? doc.lineItems.map((item) => ({
          description: item.description || null,
          kind: item.kind || 'service',
          quantity: item.quantity ?? 0,
          unitPrice: item.unitPrice ?? 0,
          amount: item.amount ?? 0,
        }))
      : [],
    subtotal: doc.subtotal ?? 0,
    discountTotal: doc.discountTotal ?? 0,
    taxTotal: doc.taxTotal ?? 0,
    total: doc.total ?? 0,
    amountPaid: doc.amountPaid ?? 0,
    amountCredited: doc.amountCredited ?? 0,
    balanceDue: doc.balanceDue ?? 0,
    autopay: {
      enabled: doc.autopayEnabled === true,
      status: doc.autopayStatus || 'not-applicable',
      attemptCount: doc.autopayAttemptCount ?? 0,
      lastAttemptAt: doc.lastAutopayAttemptAt || null,
      nextRetryAt: doc.nextAutopayRetryAt || null,
    },
    dunning: {
      stage: doc.dunningStage || 'none',
      lastDunningAt: doc.lastDunningAt || null,
      nextDunningAt: doc.nextDunningAt || null,
    },
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

function serializeIntegrationPayment(payment) {
  const doc = toPlain(payment);
  if (!doc) return null;

  return {
    id: toId(doc._id),
    amount: doc.amount ?? 0,
    currency: doc.currency || 'KES',
    status: doc.status || null,
    method: doc.method || null,
    transactionId: doc.transactionId || null,
    merchantRequestId: doc.merchantRequestId || null,
    checkoutRequestId: doc.checkoutRequestId || null,
    accountNumber: doc.accountNumber || doc.customer?.accountNumber || null,
    phoneNumber: doc.phoneNumber || null,
    customer: compactCustomer(doc.customer),
    invoice: doc.invoice
      ? {
          id: toId(doc.invoice._id || doc.invoice),
          invoiceNumber: doc.invoice.invoiceNumber || null,
          status: doc.invoice.status || null,
          total: doc.invoice.total ?? null,
          balanceDue: doc.invoice.balanceDue ?? null,
          dueDate: doc.invoice.dueDate || null,
        }
      : null,
    plan: compactPlan(doc.plan),
    allocatedAmount: doc.allocatedAmount ?? 0,
    unappliedAmount: doc.unappliedAmount ?? 0,
    isFinanciallyApplied: doc.isFinanciallyApplied === true,
    financialAppliedAt: doc.financialAppliedAt || null,
    refundAmount: doc.refundAmount ?? 0,
    refundedAt: doc.refundedAt || null,
    chargebackAmount: doc.chargebackAmount ?? 0,
    chargedBackAt: doc.chargedBackAt || null,
    expiryDate: doc.expiryDate || null,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

async function listIntegrationCustomers(tenantId, options = {}) {
  const limit = parseIntegrationLimit(options.limit);
  const filter = { tenantId };
  if (options.status) filter.status = String(options.status).trim();
  if (options.q) {
    const regex = new RegExp(escapeRegex(options.q), 'i');
    filter.$or = [
      { name: regex },
      { accountNumber: regex },
      { accountAliases: regex },
      { email: regex },
      { phone: regex },
      { address: regex },
    ];
  }

  const customers = await Customer.find(filter)
    .select({ 'portalProfile.pinHash': 0 })
    .sort({ name: 1, accountNumber: 1 })
    .limit(limit)
    .populate('plan', 'name price duration durationDays speed')
    .lean();

  return customers.map(serializeIntegrationCustomer);
}

async function getIntegrationCustomer(tenantId, customerId) {
  if (!mongoose.isValidObjectId(customerId)) throw serviceError(400, 'Invalid customer id');
  const customer = await Customer.findOne({ _id: customerId, tenantId })
    .select({ 'portalProfile.pinHash': 0 })
    .populate('plan', 'name price duration durationDays speed')
    .lean();
  if (!customer) throw serviceError(404, 'Customer not found');
  return serializeIntegrationCustomer(customer);
}

async function listIntegrationInvoices(tenantId, options = {}) {
  const limit = parseIntegrationLimit(options.limit);
  const filter = { tenantId };
  if (options.status) filter.status = String(options.status).trim();
  if (options.customerId) {
    if (!mongoose.isValidObjectId(options.customerId)) throw serviceError(400, 'Invalid customer id');
    filter.customer = String(options.customerId).trim();
  }

  const invoices = await Invoice.find(filter)
    .sort({ dueDate: -1, createdAt: -1 })
    .limit(limit)
    .populate('customer', 'name accountNumber phone email connectionType')
    .populate('plan', 'name price duration durationDays speed')
    .lean();

  return invoices.map(serializeIntegrationInvoice);
}

async function getIntegrationInvoice(tenantId, invoiceId) {
  if (!mongoose.isValidObjectId(invoiceId)) throw serviceError(400, 'Invalid invoice id');
  const invoice = await Invoice.findOne({ _id: invoiceId, tenantId })
    .populate('customer', 'name accountNumber phone email connectionType')
    .populate('plan', 'name price duration durationDays speed')
    .lean();
  if (!invoice) throw serviceError(404, 'Invoice not found');
  return serializeIntegrationInvoice(invoice);
}

async function listIntegrationPayments(tenantId, options = {}) {
  const rows = await listPayments(tenantId, {
    limit: parseIntegrationLimit(options.limit),
    includeDeleted: false,
  });
  return rows.map(serializeIntegrationPayment);
}

async function createIntegrationSupportTicket(tenantId, payload = {}, actor = null) {
  const nextPayload = { ...payload };
  const accountNumber = String(
    payload.accountNumber || payload.customerAccountNumber || ''
  ).trim();

  if (!nextPayload.customerId && accountNumber) {
    const customer = await Customer.findOne({ tenantId, accountNumber }).select({ _id: 1 }).lean();
    if (!customer) throw serviceError(404, 'Customer not found for accountNumber');
    nextPayload.customerId = String(customer._id);
  }

  nextPayload.channel = nextPayload.channel || 'integration';
  return createSupportTicket(tenantId, nextPayload, actor);
}

module.exports = {
  createIntegrationSupportTicket,
  getIntegrationCustomer,
  getIntegrationInvoice,
  listIntegrationCustomers,
  listIntegrationInvoices,
  listIntegrationPayments,
  parseIntegrationLimit,
  serializeIntegrationCustomer,
  serializeIntegrationInvoice,
  serializeIntegrationPayment,
};
