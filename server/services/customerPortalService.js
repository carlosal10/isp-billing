'use strict';

const bcrypt = require('bcryptjs');
const Customer = require('../models/customers');
const InventoryAsset = require('../models/InventoryAsset');
const Invoice = require('../models/Invoice');
const NocIncident = require('../models/NocIncident');
const Payment = require('../models/Payment');
const SupportTicket = require('../models/SupportTicket');
const { ensureInvoiceGenerated } = require('./billingFinanceService');
const { upsertStkCorrelation } = require('./paymentGatewayCorrelationService');
const { createSupportTicket } = require('./supportOperationsService');
const { initiateSTKPush } = require('../utils/mpesa');
const { normalizeMsisdn } = require('../utils/stkPush');

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

function serializeInvoice(invoice) {
  return {
    _id: toId(invoice._id),
    invoiceNumber: invoice.invoiceNumber || null,
    issueDate: invoice.issueDate || null,
    dueDate: invoice.dueDate || null,
    total: Number(invoice.total || 0),
    amountPaid: Number(invoice.amountPaid || 0),
    amountCredited: Number(invoice.amountCredited || 0),
    balanceDue: Number(invoice.balanceDue || 0),
    status: invoice.status || 'draft',
    dunningStage: invoice.dunningStage || 'none',
    autopayStatus: invoice.autopayStatus || 'not-applicable',
    billingReason: invoice.billingReason || 'manual',
    currency: invoice.currency || 'KES',
    lineItems: Array.isArray(invoice.lineItems) ? invoice.lineItems : [],
  };
}

function serializePayment(payment) {
  return {
    _id: toId(payment._id),
    amount: Number(payment.amount || 0),
    status: payment.status || 'Pending',
    method: payment.method || null,
    phoneNumber: payment.phoneNumber || null,
    transactionId: payment.transactionId || null,
    createdAt: payment.createdAt || null,
    invoiceId: payment.invoice ? toId(payment.invoice._id || payment.invoice) : null,
    invoiceNumber: payment.invoice?.invoiceNumber || null,
    planName: payment.plan?.name || null,
  };
}

function serializeTicket(ticket) {
  return {
    _id: toId(ticket._id),
    ticketNumber: ticket.ticketNumber || null,
    title: ticket.title || null,
    description: ticket.description || null,
    status: ticket.status || 'open',
    priority: ticket.priority || 'medium',
    channel: ticket.channel || 'portal',
    category: ticket.category || null,
    openedAt: ticket.openedAt || ticket.createdAt || null,
    resolutionDueAt: ticket.resolutionDueAt || null,
    workOrder: ticket.workOrder
      ? {
          _id: toId(ticket.workOrder._id || ticket.workOrder),
          orderNumber: ticket.workOrder.orderNumber || null,
          status: ticket.workOrder.status || null,
          type: ticket.workOrder.type || null,
        }
      : null,
    asset: ticket.asset
      ? {
          _id: toId(ticket.asset._id || ticket.asset),
          assetTag: ticket.asset.assetTag || null,
          name: ticket.asset.name || null,
        }
      : null,
    notes: Array.isArray(ticket.notes) ? ticket.notes : [],
  };
}

function serializeIncident(incident) {
  return {
    _id: toId(incident._id),
    incidentNumber: incident.incidentNumber || null,
    title: incident.title || null,
    summary: incident.summary || null,
    kind: incident.kind || 'outage',
    severity: incident.severity || 'medium',
    status: incident.status || 'open',
    site: incident.site || null,
    routerName: incident.routerName || null,
    startedAt: incident.startedAt || null,
    plannedStart: incident.plannedStart || null,
    plannedEnd: incident.plannedEnd || null,
    resolvedAt: incident.resolvedAt || null,
    updates: Array.isArray(incident.updates) ? incident.updates : [],
  };
}

function validatePortalPin(value) {
  const pin = String(value || '').trim();
  if (!/^\d{4,8}$/.test(pin)) {
    throw serviceError(400, 'Portal PIN must be 4 to 8 digits');
  }
  return pin;
}

async function getPortalCustomer(tenantId, customerId) {
  const customer = await Customer.findOne({ _id: customerId, tenantId })
    .populate('plan', 'name price duration speed')
    .lean();
  if (!customer || customer.portalProfile?.isEnabled === false) {
    throw serviceError(404, 'Customer portal profile not found');
  }
  return customer;
}

async function assertPortalAccess(tenantId, customerId) {
  const customer = await Customer.findOne({ _id: customerId, tenantId })
    .select('_id portalProfile.isEnabled')
    .lean();
  if (!customer || customer.portalProfile?.isEnabled === false) {
    throw serviceError(404, 'Customer portal profile not found');
  }
  return customer;
}

async function listPortalAssets(tenantId, customerId) {
  return InventoryAsset.find({ tenantId, assignedCustomer: customerId })
    .sort({ assetTag: 1 })
    .select({
      assetTag: 1,
      name: 1,
      kind: 1,
      status: 1,
      managementIp: 1,
      site: 1,
      location: 1,
      installedAt: 1,
    })
    .lean();
}

async function getPortalOverview(tenantId, customerId) {
  const customer = await getPortalCustomer(tenantId, customerId);
  const assets = await listPortalAssets(tenantId, customerId);
  const assetIds = assets.map((asset) => asset._id);

  const [invoices, openInvoiceRows, openTickets, incidents] = await Promise.all([
    Invoice.find({ tenantId, customer: customerId })
      .sort({ dueDate: -1, createdAt: -1 })
      .limit(5)
      .lean(),
    Invoice.find({
      tenantId,
      customer: customerId,
      balanceDue: { $gt: 0 },
      status: { $ne: 'voided' },
    })
      .select({ balanceDue: 1 })
      .lean(),
    SupportTicket.countDocuments({
      tenantId,
      customer: customerId,
      status: { $in: ['open', 'in_progress', 'waiting'] },
    }),
    NocIncident.countDocuments({
      tenantId,
      status: { $in: ['scheduled', 'open', 'investigating', 'monitoring'] },
      $or: [
        { affectedCustomers: customerId },
        ...(assetIds.length ? [{ affectedAssets: { $in: assetIds } }] : []),
      ],
    }),
  ]);

  const outstandingBalance = openInvoiceRows.reduce(
    (sum, invoice) => sum + Number(invoice.balanceDue || 0),
    0
  );

  return {
    tenant: {
      id: String(tenantId),
      name: customer?.tenantName || null,
    },
    customer: {
      _id: toId(customer._id),
      name: customer.name || null,
      accountNumber: customer.accountNumber || null,
      email: customer.email || null,
      phone: customer.phone || null,
      address: customer.address || null,
      status: customer.status || 'active',
      expiryDate: customer.expiryDate || null,
      connectionType: customer.connectionType || null,
      plan: customer.plan
        ? {
            _id: toId(customer.plan._id || customer.plan),
            name: customer.plan.name || null,
            price: Number(customer.plan.price || 0),
            duration: customer.plan.duration || null,
            speed: customer.plan.speed || null,
          }
        : null,
      billingProfile: {
        autopayEnabled: Boolean(customer.billingProfile?.autopayEnabled),
        preferredPaymentMethod: customer.billingProfile?.preferredPaymentMethod || 'mpesa',
        graceDays: Number(customer.billingProfile?.graceDays || 0),
      },
      portalProfile: {
        hasPin: Boolean(customer.portalProfile?.pinHash),
        lastLoginAt: customer.portalProfile?.lastLoginAt || null,
      },
    },
    balances: {
      outstandingBalance: Math.round(outstandingBalance * 100) / 100,
      openInvoiceCount: openInvoiceRows.length,
    },
    support: {
      openTickets: Number(openTickets || 0),
    },
    network: {
      activeIncidents: Number(incidents || 0),
      assignedAssets: assets.length,
      assets,
    },
    recentInvoices: invoices.map(serializeInvoice),
  };
}

async function listPortalInvoices(tenantId, customerId, limit = 50) {
  await assertPortalAccess(tenantId, customerId);
  const invoices = await Invoice.find({ tenantId, customer: customerId })
    .sort({ dueDate: -1, createdAt: -1 })
    .limit(Math.min(Number(limit) || 50, 100))
    .lean();
  return invoices.map(serializeInvoice);
}

async function listPortalPayments(tenantId, customerId, limit = 50) {
  await assertPortalAccess(tenantId, customerId);
  const payments = await Payment.find({ tenantId, customer: customerId })
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 50, 100))
    .populate('invoice', 'invoiceNumber')
    .populate('plan', 'name')
    .lean();
  return payments.map(serializePayment);
}

async function getPortalPaymentStatus(tenantId, customerId, paymentId) {
  await assertPortalAccess(tenantId, customerId);
  const payment = await Payment.findOne({ _id: paymentId, tenantId, customer: customerId })
    .populate('invoice', 'invoiceNumber')
    .populate('plan', 'name')
    .lean();
  if (!payment) throw serviceError(404, 'Payment not found');
  return serializePayment(payment);
}

async function listPortalTickets(tenantId, customerId, limit = 50) {
  await assertPortalAccess(tenantId, customerId);
  const tickets = await SupportTicket.find({ tenantId, customer: customerId })
    .sort({ openedAt: -1, createdAt: -1 })
    .limit(Math.min(Number(limit) || 50, 100))
    .populate('asset', 'assetTag name')
    .populate('workOrder', 'orderNumber status type')
    .lean();
  return tickets.map(serializeTicket);
}

async function listPortalIncidents(tenantId, customerId, { activeOnly = true, limit = 50 } = {}) {
  await assertPortalAccess(tenantId, customerId);
  const assets = await listPortalAssets(tenantId, customerId);
  const assetIds = assets.map((asset) => asset._id);
  const filter = {
    tenantId,
    ...(activeOnly ? { status: { $in: ['scheduled', 'open', 'investigating', 'monitoring'] } } : {}),
    $or: [
      { affectedCustomers: customerId },
      ...(assetIds.length ? [{ affectedAssets: { $in: assetIds } }] : []),
    ],
  };

  const incidents = await NocIncident.find(filter)
    .sort({ startedAt: -1, createdAt: -1 })
    .limit(Math.min(Number(limit) || 50, 100))
    .lean();
  return incidents.map(serializeIncident);
}

async function createPortalTicket(tenantId, customerId, payload = {}) {
  await assertPortalAccess(tenantId, customerId);
  let assetId = payload.assetId || null;
  if (assetId) {
    const asset = await InventoryAsset.findOne({
      _id: assetId,
      tenantId,
      assignedCustomer: customerId,
    }).lean();
    if (!asset) {
      throw serviceError(403, 'Selected asset is not assigned to this customer');
    }
  }

  return createSupportTicket(
    tenantId,
    {
      title: payload.title,
      description: payload.description,
      category: payload.category,
      priority: ['low', 'medium', 'high'].includes(String(payload.priority || '').trim().toLowerCase())
        ? String(payload.priority).trim().toLowerCase()
        : 'medium',
      channel: 'portal',
      customerId,
      assetId,
      notes: typeof payload.note === 'string' && payload.note.trim()
        ? [{ author: 'customer-portal', body: payload.note.trim() }]
        : [],
      tags: ['portal'],
    },
    {
      id: `customer:${customerId}`,
      email: null,
      role: 'customer',
    }
  );
}

async function initiatePortalMpesaPayment(tenantId, customerId, payload = {}) {
  const invoiceId = String(payload.invoiceId || '').trim();
  if (!invoiceId) throw serviceError(400, 'invoiceId is required');

  const [customer, invoice] = await Promise.all([
    Customer.findOne({ _id: customerId, tenantId })
      .populate('plan', 'name price duration')
      .lean(),
    Invoice.findOne({ _id: invoiceId, tenantId, customer: customerId })
      .populate('plan', 'name price duration'),
  ]);

  if (!customer) throw serviceError(404, 'Customer not found');
  if (customer.portalProfile?.isEnabled === false) {
    throw serviceError(404, 'Customer portal profile not found');
  }
  if (!invoice) throw serviceError(404, 'Invoice not found');
  if (!invoice.plan) throw serviceError(409, 'Invoice is missing plan information');

  await ensureInvoiceGenerated({ tenantId, invoiceId: invoice._id }).catch(() => null);
  const freshInvoice = await Invoice.findOne({ _id: invoice._id, tenantId, customer: customerId })
    .populate('plan', 'name price duration');
  const amount = Math.round(Number(freshInvoice?.balanceDue || 0));
  if (!(amount >= 1)) throw serviceError(409, 'Invoice has no outstanding balance');

  const preferredPhone =
    payload.phone ||
    customer.billingProfile?.preferredPhoneNumber ||
    customer.phone ||
    null;
  const msisdn = normalizeMsisdn(preferredPhone);
  if (!msisdn) throw serviceError(400, 'A valid M-Pesa phone number is required');

  const payment = await Payment.create({
    tenantId,
    accountNumber: customer.accountNumber,
    phoneNumber: msisdn,
    customer: customer._id,
    invoice: freshInvoice._id,
    plan: freshInvoice.plan._id || freshInvoice.plan,
    amount,
    method: 'mpesa',
    status: 'Pending',
  });

  const apiBase = process.env.VITE_API_URL || '';
  const serverBase = apiBase.replace(/\/?api\/?$/, '');
  const callbackUrl =
    process.env.MPESA_CALLBACK_URL ||
    `${serverBase}/api/payment/callback/callback`;

  const stkResponse = await initiateSTKPush({
    ispId: tenantId,
    amount,
    phone: msisdn,
    accountReference: customer.accountNumber,
    callbackURL: callbackUrl,
  });

  const checkoutRequestId = stkResponse?.CheckoutRequestID;
  const merchantRequestId = stkResponse?.MerchantRequestID;
  if (checkoutRequestId || merchantRequestId) {
    await Payment.updateOne(
      { _id: payment._id, tenantId },
      {
        $set: {
          checkoutRequestId: checkoutRequestId || undefined,
          merchantRequestId: merchantRequestId || undefined,
        },
      }
    );
    await upsertStkCorrelation({
      tenantId,
      paymentId: payment._id,
      customerId,
      planId: freshInvoice.plan._id || freshInvoice.plan,
      accountNumber: customer.accountNumber || null,
      phoneNumber: msisdn,
      amount,
      checkoutRequestId,
      merchantRequestId,
      source: 'portal:/payments/mpesa/stk',
      callbackUrl,
    }).catch((err) => {
      console.warn('Could not persist portal STK correlation:', err?.message || err);
    });
  }

  return {
    ok: true,
    paymentId: String(payment._id),
    invoiceId: String(freshInvoice._id),
    amount,
    phoneNumber: msisdn,
    customerMessage: stkResponse?.CustomerMessage || 'STK push initiated',
    checkoutRequestId: checkoutRequestId || null,
    merchantRequestId: merchantRequestId || null,
  };
}

async function updatePortalPin(tenantId, customerId, payload = {}) {
  const customer = await Customer.findOne({ _id: customerId, tenantId });
  if (!customer || customer.portalProfile?.isEnabled === false) {
    throw serviceError(404, 'Customer portal profile not found');
  }

  const nextPin = validatePortalPin(payload.newPin);
  const existingHash = customer.portalProfile?.pinHash || null;
  if (existingHash) {
    const ok = await bcrypt.compare(String(payload.currentPin || ''), existingHash);
    if (!ok) throw serviceError(403, 'Current PIN is incorrect');
  }

  customer.set('portalProfile.isEnabled', customer.portalProfile?.isEnabled !== false);
  customer.set('portalProfile.pinHash', await bcrypt.hash(nextPin, 12));
  customer.set('portalProfile.lastSeenAt', new Date());
  await customer.save();

  return {
    ok: true,
    hasPin: true,
  };
}

module.exports = {
  createPortalTicket,
  getPortalCustomer,
  getPortalOverview,
  getPortalPaymentStatus,
  initiatePortalMpesaPayment,
  listPortalIncidents,
  listPortalInvoices,
  listPortalPayments,
  listPortalTickets,
  updatePortalPin,
};
