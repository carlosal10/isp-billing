'use strict';

const Customer = require('../models/customers');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const CreditNote = require('../models/CreditNote');
const InvoiceAllocation = require('../models/InvoiceAllocation');
const BillingLedgerEntry = require('../models/BillingLedgerEntry');
const MessageDelivery = require('../models/MessageDelivery');
const PaymentGatewayEvent = require('../models/PaymentGatewayEvent');
const SupportTicket = require('../models/SupportTicket');
const WorkOrder = require('../models/WorkOrder');
const AuditLog = require('../models/AuditLog');
const { releaseCustomerIpAssignment } = require('../utils/staticIpPool');
const {
  maskAccountNumber,
  maskEmail,
  maskIdentifier,
  maskPhone,
  maskTransactionId,
  redactObject,
} = require('./privacyService');

const ANONYMIZED_TEXT = '[anonymized]';
const DEFAULT_EXPORT_LIMIT = 500;
const MAX_EXPORT_LIMIT = 2000;

const DEFAULT_MODELS = Object.freeze({
  Customer,
  Invoice,
  Payment,
  CreditNote,
  InvoiceAllocation,
  BillingLedgerEntry,
  MessageDelivery,
  PaymentGatewayEvent,
  SupportTicket,
  WorkOrder,
  AuditLog,
});

function serviceError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function toId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}

function toPlain(value) {
  if (!value) return null;
  return typeof value.toObject === 'function' ? value.toObject() : value;
}

function normalizePrivacyMode(value) {
  return String(value || '').toLowerCase() === 'full' ? 'full' : 'masked';
}

function shouldMask(options = {}) {
  return normalizePrivacyMode(options.privacyMode) !== 'full';
}

function maybeMask(value, maskFn, options = {}) {
  if (value == null || value === '') return value ?? null;
  return shouldMask(options) ? maskFn(value) : value;
}

function parseLimit(value, fallback = DEFAULT_EXPORT_LIMIT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), MAX_EXPORT_LIMIT);
}

function anonymizedAccountNumber(customerId) {
  const source = String(customerId || '').replace(/[^a-zA-Z0-9]/g, '');
  const suffix = (source.slice(-10) || 'CUSTOMER').toUpperCase();
  return `ANON-${suffix}`;
}

function anonymizedName(customerId) {
  const source = String(customerId || '').replace(/[^a-zA-Z0-9]/g, '');
  const suffix = (source.slice(-6) || 'record').toUpperCase();
  return `Anonymized Customer ${suffix}`;
}

function buildAnonymizationConfirmation(customer = {}) {
  return `ANONYMIZE-${String(customer.accountNumber || toId(customer._id) || '').trim().toUpperCase()}`;
}

function buildAnonymizedCustomerPatch({ customer, actor = null, reason = null, now = new Date() } = {}) {
  const customerId = toId(customer?._id);
  const accountNumber = anonymizedAccountNumber(customerId);
  const actorId = actor?.id || actor?.email || null;

  return {
    name: anonymizedName(customerId),
    email: null,
    phone: null,
    address: null,
    routerIp: null,
    status: 'anonymized',
    expiryDate: null,
    accountNumber,
    accountAliases: [],
    staticConfig: undefined,
    pppoeConfig: undefined,
    billingProfile: {
      invoiceLeadDays: customer?.billingProfile?.invoiceLeadDays ?? 3,
      autopayEnabled: false,
      preferredPaymentMethod: customer?.billingProfile?.preferredPaymentMethod || 'mpesa',
      preferredPhoneNumber: null,
      stripeCustomerId: null,
      stripePaymentMethodId: null,
      graceDays: customer?.billingProfile?.graceDays ?? 3,
      retryIntervalDays: customer?.billingProfile?.retryIntervalDays ?? 2,
      maxAutopayAttempts: 0,
    },
    portalProfile: {
      isEnabled: false,
      pinHash: null,
      lastLoginAt: customer?.portalProfile?.lastLoginAt || null,
      lastLoginMethod: customer?.portalProfile?.lastLoginMethod || null,
      lastSeenAt: customer?.portalProfile?.lastSeenAt || null,
    },
    communicationPreferences: {
      preferredLanguage: customer?.communicationPreferences?.preferredLanguage || 'en',
      transactionalSmsEnabled: false,
      billingSmsEnabled: false,
      serviceAlertsSmsEnabled: false,
      marketingSmsEnabled: false,
      doNotContactUntil: null,
      quietHours: {
        enabled: false,
        start: '21:00',
        end: '07:00',
        timezone: customer?.communicationPreferences?.quietHours?.timezone || 'Africa/Nairobi',
      },
      updatedAt: now,
      updatedBy: actorId,
    },
    privacyProfile: {
      isAnonymized: true,
      anonymizedAt: now,
      anonymizedBy: actorId,
      anonymizationReason: reason || 'Customer privacy anonymization',
      originalCustomerId: customerId,
    },
  };
}

function serializePortalProfile(customer = {}) {
  const profile = customer.portalProfile || {};
  return {
    isEnabled: profile.isEnabled !== false,
    hasPin: Boolean(profile.pinHash),
    lastLoginAt: profile.lastLoginAt || null,
    lastLoginMethod: profile.lastLoginMethod || null,
    lastSeenAt: profile.lastSeenAt || null,
  };
}

function serializeBillingProfile(customer = {}, options = {}) {
  const profile = customer.billingProfile || {};
  return {
    invoiceLeadDays: profile.invoiceLeadDays ?? null,
    autopayEnabled: profile.autopayEnabled === true,
    preferredPaymentMethod: profile.preferredPaymentMethod || null,
    preferredPhoneNumber: maybeMask(profile.preferredPhoneNumber, maskPhone, options),
    stripeCustomerId: maybeMask(profile.stripeCustomerId, maskIdentifier, options),
    stripePaymentMethodId: maybeMask(profile.stripePaymentMethodId, maskIdentifier, options),
    graceDays: profile.graceDays ?? null,
    retryIntervalDays: profile.retryIntervalDays ?? null,
    maxAutopayAttempts: profile.maxAutopayAttempts ?? null,
  };
}

function serializeCustomerSubject(customer = {}, options = {}) {
  const doc = toPlain(customer) || {};
  return {
    _id: toId(doc._id),
    tenantId: toId(doc.tenantId),
    name: shouldMask(options) ? maskIdentifier(doc.name, { prefix: 1, suffix: 1 }) : doc.name || null,
    email: maybeMask(doc.email, maskEmail, options),
    phone: maybeMask(doc.phone, maskPhone, options),
    address: shouldMask(options) ? (doc.address ? ANONYMIZED_TEXT : null) : doc.address || null,
    accountNumber: maybeMask(doc.accountNumber, maskAccountNumber, options),
    accountAliases: Array.isArray(doc.accountAliases)
      ? doc.accountAliases.map((alias) => maybeMask(alias, maskAccountNumber, options))
      : [],
    status: doc.status || null,
    expiryDate: doc.expiryDate || null,
    plan: doc.plan || null,
    connectionType: doc.connectionType || null,
    pppoeConfig: doc.pppoeConfig
      ? {
          profile: doc.pppoeConfig.profile || null,
          localAddress: shouldMask(options)
            ? maybeMask(doc.pppoeConfig.localAddress, maskIdentifier, options)
            : doc.pppoeConfig.localAddress || null,
          rateLimit: doc.pppoeConfig.rateLimit || null,
        }
      : null,
    staticConfig: doc.staticConfig
      ? {
          ip: maybeMask(doc.staticConfig.ip, maskIdentifier, options),
          gateway: maybeMask(doc.staticConfig.gateway, maskIdentifier, options),
          dns: maybeMask(doc.staticConfig.dns, maskIdentifier, options),
        }
      : null,
    billingProfile: serializeBillingProfile(doc, options),
    portalProfile: serializePortalProfile(doc),
    communicationPreferences: doc.communicationPreferences || {},
    privacyProfile: doc.privacyProfile || null,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

function serializePayment(payment = {}, options = {}) {
  const doc = toPlain(payment) || {};
  return {
    _id: toId(doc._id),
    invoice: toId(doc.invoice),
    plan: toId(doc.plan),
    amount: doc.amount ?? null,
    currency: doc.currency || 'KES',
    method: doc.method || null,
    status: doc.status || null,
    accountNumber: maybeMask(doc.accountNumber, maskAccountNumber, options),
    phoneNumber: maybeMask(doc.phoneNumber, maskPhone, options),
    transactionId: maybeMask(doc.transactionId, maskTransactionId, options),
    expiryDate: doc.expiryDate || null,
    allocatedAmount: doc.allocatedAmount || 0,
    unappliedAmount: doc.unappliedAmount || 0,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

function serializeGatewayEvent(event = {}, options = {}) {
  const doc = toPlain(event) || {};
  return {
    _id: toId(doc._id),
    provider: doc.provider || null,
    kind: doc.kind || null,
    eventType: doc.eventType || null,
    eventStatus: doc.eventStatus || null,
    accountNumber: maybeMask(doc.accountNumber, maskAccountNumber, options),
    phoneNumber: maybeMask(doc.phoneNumber, maskPhone, options),
    transactionId: maybeMask(doc.transactionId, maskTransactionId, options),
    amount: doc.amount ?? null,
    currency: doc.currency || null,
    resultCode: doc.resultCode ?? null,
    resultDesc: doc.resultDesc || null,
    payload: redactObject(doc.payload || null),
    headers: redactObject(doc.headers || null),
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

function serializeMessage(delivery = {}, options = {}) {
  const doc = toPlain(delivery) || {};
  return {
    _id: toId(doc._id),
    channel: doc.channel || 'sms',
    direction: doc.direction || 'outbound',
    provider: doc.provider || null,
    templateType: doc.templateType || null,
    status: doc.status || null,
    to: maybeMask(doc.to, maskPhone, options),
    normalizedTo: maybeMask(doc.normalizedTo, maskPhone, options),
    subject: shouldMask(options) ? (doc.subject ? ANONYMIZED_TEXT : null) : doc.subject || null,
    bodyPreview: shouldMask(options) ? (doc.bodyPreview ? ANONYMIZED_TEXT : null) : doc.bodyPreview || null,
    bodyLength: doc.bodyLength || 0,
    providerStatus: doc.providerStatus || null,
    errorMessage: shouldMask(options) ? (doc.errorMessage ? ANONYMIZED_TEXT : null) : doc.errorMessage || null,
    context: redactObject(doc.context || {}),
    sentAt: doc.sentAt || null,
    failedAt: doc.failedAt || null,
    createdAt: doc.createdAt || null,
  };
}

function serializeSupportTicket(ticket = {}, options = {}) {
  const doc = toPlain(ticket) || {};
  return {
    _id: toId(doc._id),
    ticketNumber: doc.ticketNumber || null,
    title: shouldMask(options) ? (doc.title ? ANONYMIZED_TEXT : null) : doc.title || null,
    description: shouldMask(options) ? (doc.description ? ANONYMIZED_TEXT : null) : doc.description || null,
    status: doc.status || null,
    priority: doc.priority || null,
    category: doc.category || null,
    openedAt: doc.openedAt || null,
    resolvedAt: doc.resolvedAt || null,
    closedAt: doc.closedAt || null,
    notes: shouldMask(options) ? [] : doc.notes || [],
  };
}

function serializeWorkOrder(order = {}, options = {}) {
  const doc = toPlain(order) || {};
  return {
    _id: toId(doc._id),
    orderNumber: doc.orderNumber || null,
    type: doc.type || null,
    status: doc.status || null,
    priority: doc.priority || null,
    summary: shouldMask(options) ? (doc.summary ? ANONYMIZED_TEXT : null) : doc.summary || null,
    site: shouldMask(options) ? (doc.site ? ANONYMIZED_TEXT : null) : doc.site || null,
    scheduledFor: doc.scheduledFor || null,
    completedAt: doc.completedAt || null,
    cancelledAt: doc.cancelledAt || null,
    resolutionNotes: shouldMask(options) ? (doc.resolutionNotes ? ANONYMIZED_TEXT : null) : doc.resolutionNotes || null,
  };
}

function serializeBasicRecord(doc = {}) {
  return redactObject(toPlain(doc) || {});
}

async function limitedFind(model, filter, options = {}) {
  return model.find(filter).sort(options.sort || { createdAt: -1 }).limit(options.limit).lean();
}

async function exportCustomerPrivacyBundle({
  tenantId,
  customerId,
  privacyMode = 'masked',
  limit = DEFAULT_EXPORT_LIMIT,
  models = DEFAULT_MODELS,
} = {}) {
  const normalizedLimit = parseLimit(limit);
  const customer = await models.Customer.findOne({ _id: customerId, tenantId })
    .select({ 'portalProfile.pinHash': 0 })
    .populate('plan', 'name price duration speed')
    .lean();
  if (!customer) throw serviceError(404, 'Customer not found');

  const exportOptions = { privacyMode: normalizePrivacyMode(privacyMode) };
  const customerObjectId = customer._id;
  const accountNumber = customer.accountNumber || null;
  const phone = customer.phone || null;
  const gatewayFilter = {
    tenantId,
    $or: [
      ...(accountNumber ? [{ accountNumber }] : []),
      ...(phone ? [{ phoneNumber: phone }] : []),
    ],
  };

  const [
    invoices,
    payments,
    creditNotes,
    allocations,
    ledgerEntries,
    messages,
    gatewayEvents,
    supportTickets,
    workOrders,
    auditLogs,
  ] = await Promise.all([
    limitedFind(models.Invoice, { tenantId, customer: customerObjectId }, { limit: normalizedLimit, sort: { issueDate: -1 } }),
    limitedFind(models.Payment, { tenantId, customer: customerObjectId }, { limit: normalizedLimit }),
    limitedFind(models.CreditNote, { tenantId, customer: customerObjectId }, { limit: normalizedLimit, sort: { issuedAt: -1 } }),
    limitedFind(models.InvoiceAllocation, { tenantId, customer: customerObjectId }, { limit: normalizedLimit, sort: { appliedAt: -1 } }),
    limitedFind(models.BillingLedgerEntry, { tenantId, customer: customerObjectId }, { limit: normalizedLimit, sort: { effectiveAt: -1 } }),
    limitedFind(models.MessageDelivery, { tenantId, customer: customerObjectId }, { limit: normalizedLimit }),
    gatewayFilter.$or.length
      ? limitedFind(models.PaymentGatewayEvent, gatewayFilter, { limit: normalizedLimit })
      : Promise.resolve([]),
    limitedFind(models.SupportTicket, { tenantId, customer: customerObjectId }, { limit: normalizedLimit, sort: { openedAt: -1 } }),
    limitedFind(models.WorkOrder, { tenantId, customer: customerObjectId }, { limit: normalizedLimit, sort: { scheduledFor: -1 } }),
    limitedFind(
      models.AuditLog,
      {
        tenantId,
        $or: [
          { 'payload.customerId': String(customerObjectId) },
          { 'payload.customer': String(customerObjectId) },
          { 'payload.accountNumber': accountNumber },
        ],
      },
      { limit: normalizedLimit }
    ),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    privacyMode: exportOptions.privacyMode,
    subject: serializeCustomerSubject(customer, exportOptions),
    records: {
      invoices: invoices.map(serializeBasicRecord),
      payments: payments.map((item) => serializePayment(item, exportOptions)),
      creditNotes: creditNotes.map(serializeBasicRecord),
      invoiceAllocations: allocations.map(serializeBasicRecord),
      ledgerEntries: ledgerEntries.map(serializeBasicRecord),
      messageDeliveries: messages.map((item) => serializeMessage(item, exportOptions)),
      paymentGatewayEvents: gatewayEvents.map((item) => serializeGatewayEvent(item, exportOptions)),
      supportTickets: supportTickets.map((item) => serializeSupportTicket(item, exportOptions)),
      workOrders: workOrders.map((item) => serializeWorkOrder(item, exportOptions)),
      auditLogs: auditLogs.map(serializeBasicRecord),
    },
    limits: {
      perCollection: normalizedLimit,
      truncatedCollections: Object.entries({
        invoices,
        payments,
        creditNotes,
        allocations,
        ledgerEntries,
        messages,
        gatewayEvents,
        supportTickets,
        workOrders,
        auditLogs,
      })
        .filter(([, rows]) => rows.length >= normalizedLimit)
        .map(([key]) => key),
    },
  };
}

async function countModel(model, filter) {
  return Number(await model.countDocuments(filter)) || 0;
}

async function buildCustomerAnonymizationPlan({
  tenantId,
  customerId,
  models = DEFAULT_MODELS,
} = {}) {
  const customer = await models.Customer.findOne({ _id: customerId, tenantId }).lean();
  if (!customer) throw serviceError(404, 'Customer not found');

  const customerObjectId = customer._id;
  const accountNumber = customer.accountNumber || null;
  const phone = customer.phone || null;
  const gatewayFilter = {
    tenantId,
    $or: [
      ...(accountNumber ? [{ accountNumber }] : []),
      ...(phone ? [{ phoneNumber: phone }] : []),
    ],
  };

  const [
    invoices,
    unpaidInvoices,
    payments,
    creditNotes,
    allocations,
    ledgerEntries,
    messages,
    gatewayEvents,
    openTickets,
    workOrders,
  ] = await Promise.all([
    countModel(models.Invoice, { tenantId, customer: customerObjectId }),
    countModel(models.Invoice, { tenantId, customer: customerObjectId, balanceDue: { $gt: 0 }, status: { $ne: 'voided' } }),
    countModel(models.Payment, { tenantId, customer: customerObjectId }),
    countModel(models.CreditNote, { tenantId, customer: customerObjectId }),
    countModel(models.InvoiceAllocation, { tenantId, customer: customerObjectId }),
    countModel(models.BillingLedgerEntry, { tenantId, customer: customerObjectId }),
    countModel(models.MessageDelivery, { tenantId, customer: customerObjectId }),
    gatewayFilter.$or.length ? countModel(models.PaymentGatewayEvent, gatewayFilter) : 0,
    countModel(models.SupportTicket, { tenantId, customer: customerObjectId, status: { $in: ['open', 'in_progress', 'waiting'] } }),
    countModel(models.WorkOrder, { tenantId, customer: customerObjectId, status: { $in: ['open', 'scheduled', 'dispatched', 'in_progress'] } }),
  ]);

  const warnings = [];
  if (customer.status === 'active') warnings.push('Customer is currently active; confirm service should be anonymized.');
  if (unpaidInvoices > 0) warnings.push('Customer has unpaid invoices; financial records will be retained and linked to the anonymized customer id.');
  if (openTickets > 0) warnings.push('Customer has open support tickets; ticket free text will be scrubbed.');
  if (workOrders > 0) warnings.push('Customer has active work orders; site and summary details will be scrubbed.');

  return {
    customerId: String(customerObjectId),
    tenantId: String(customer.tenantId || tenantId),
    currentAccountNumber: customer.accountNumber || null,
    anonymizedAccountNumber: anonymizedAccountNumber(customerObjectId),
    confirmationText: buildAnonymizationConfirmation(customer),
    alreadyAnonymized: customer.privacyProfile?.isAnonymized === true || customer.status === 'anonymized',
    warnings,
    counts: {
      invoices,
      unpaidInvoices,
      payments,
      creditNotes,
      invoiceAllocations: allocations,
      ledgerEntries,
      messageDeliveries: messages,
      paymentGatewayEvents: gatewayEvents,
      openSupportTickets: openTickets,
      activeWorkOrders: workOrders,
    },
    actions: [
      'Disable portal access and clear PIN hash.',
      'Remove customer email, phone, address, router IP, aliases, and billing autopay tokens.',
      'Pseudonymize customer account number for financial continuity.',
      'Remove denormalized phone/account identifiers from payments, messages, and gateway events.',
      'Scrub support ticket and work-order free text associated with this customer.',
      'Keep invoices, payments, ledger entries, and audit logs for commercial and legal reporting.',
    ],
  };
}

function assertAnonymizationConfirmation(customer, confirmation) {
  const expected = buildAnonymizationConfirmation(customer);
  if (String(confirmation || '').trim().toUpperCase() !== expected) {
    throw serviceError(400, `Confirmation must match ${expected}`);
  }
}

async function anonymizeCustomer({
  tenantId,
  customerId,
  confirmation,
  reason = null,
  actor = null,
  now = new Date(),
  models = DEFAULT_MODELS,
} = {}) {
  const customer = await models.Customer.findOne({ _id: customerId, tenantId });
  if (!customer) throw serviceError(404, 'Customer not found');
  if (customer.privacyProfile?.isAnonymized === true || customer.status === 'anonymized') {
    throw serviceError(409, 'Customer is already anonymized');
  }

  assertAnonymizationConfirmation(customer, confirmation);

  const original = {
    accountNumber: customer.accountNumber || null,
    phone: customer.phone || null,
    staticIp: customer.staticConfig?.ip || null,
    connectionType: customer.connectionType || null,
  };
  const patch = buildAnonymizedCustomerPatch({ customer, actor, reason, now });
  const anonymizedAccount = patch.accountNumber;

  Object.entries(patch).forEach(([key, value]) => {
    customer.set(key, value);
  });
  await customer.save();

  if (original.connectionType === 'static' && original.staticIp) {
    await releaseCustomerIpAssignment({
      tenantId,
      customerId: customer._id,
      ipAddress: original.staticIp,
      reason: 'Customer anonymized',
    }).catch(() => null);
  }

  const gatewayOr = [
    ...(original.accountNumber ? [{ accountNumber: original.accountNumber }] : []),
    ...(original.phone ? [{ phoneNumber: original.phone }] : []),
  ];

  const updates = {};
  const updateEntries = [
    [
      'payments',
      models.Payment.updateMany(
        { tenantId, customer: customer._id },
        { $set: { accountNumber: anonymizedAccount, phoneNumber: null } }
      ),
    ],
    [
      'messageDeliveries',
      models.MessageDelivery.updateMany(
        { tenantId, customer: customer._id },
        {
          $set: {
            to: null,
            normalizedTo: null,
            subject: null,
            bodyPreview: null,
            context: { privacy: 'customer-anonymized', anonymizedAt: now },
          },
        }
      ),
    ],
    [
      'supportTickets',
      models.SupportTicket.updateMany(
        { tenantId, customer: customer._id },
        {
          $set: {
            title: 'Customer privacy record',
            description: null,
            notes: [],
            'metadata.customerPrivacyAnonymizedAt': now,
          },
        }
      ),
    ],
    [
      'workOrders',
      models.WorkOrder.updateMany(
        { tenantId, customer: customer._id },
        {
          $set: {
            summary: 'Customer privacy record',
            site: null,
            resolutionNotes: null,
            'metadata.customerPrivacyAnonymizedAt': now,
          },
        }
      ),
    ],
  ];

  if (gatewayOr.length) {
    updateEntries.push([
      'paymentGatewayEvents',
      models.PaymentGatewayEvent.updateMany(
        { tenantId, $or: gatewayOr },
        {
          $set: {
            accountNumber: anonymizedAccount,
            phoneNumber: null,
            payload: { privacy: 'customer-anonymized', anonymizedAt: now },
            headers: null,
          },
        }
      ),
    ]);
  }

  const results = await Promise.all(updateEntries.map(([, promise]) => promise));
  updateEntries.forEach(([key], index) => {
    const result = results[index];
    updates[key] = {
      matchedCount: Number(result?.matchedCount ?? result?.n ?? 0),
      modifiedCount: Number(result?.modifiedCount ?? result?.nModified ?? 0),
    };
  });

  await models.AuditLog.create({
    tenantId,
    actor: actor?.id || actor?.email || 'system',
    action: 'customer.privacy.anonymize',
    payload: {
      customerId: String(customer._id),
      anonymizedAccountNumber: anonymizedAccount,
      reason: reason || null,
      updates,
    },
  }).catch(() => null);

  return {
    ok: true,
    customerId: String(customer._id),
    anonymizedAccountNumber: anonymizedAccount,
    updates,
  };
}

module.exports = {
  ANONYMIZED_TEXT,
  anonymizeCustomer,
  anonymizedAccountNumber,
  buildAnonymizationConfirmation,
  buildAnonymizedCustomerPatch,
  buildCustomerAnonymizationPlan,
  exportCustomerPrivacyBundle,
  normalizePrivacyMode,
  parseLimit,
  serializeCustomerSubject,
};
