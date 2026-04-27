'use strict';

const PaymentConfig = require('../models/PaymentConfig');
const MpesaSettings = require('../models/MpesaSettings');
const Payment = require('../models/Payment');
const PaymentGatewayEvent = require('../models/PaymentGatewayEvent');
const Customer = require('../models/customers');
const Plan = require('../models/plan');
const { computeExpiryDate } = require('./paymentEntitlementService');
const { syncCustomerAccessFromPayments } = require('./customerAccessService');
const {
  beginGatewayEventProcessing,
  finalizeGatewayEvent,
} = require('./paymentGatewayEventService');
const {
  findStkCorrelation,
  markStkCorrelationCallback,
} = require('./paymentGatewayCorrelationService');

function parseMpesaTimestamp(ts) {
  if (!ts) return null;
  const raw = String(ts).trim();
  if (!/^\d{14}$/.test(raw)) return null;
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6)) - 1;
  const day = Number(raw.slice(6, 8));
  const hour = Number(raw.slice(8, 10));
  const minute = Number(raw.slice(10, 12));
  const second = Number(raw.slice(12, 14));
  const date = new Date(Date.UTC(year, month, day, hour - 3, minute, second));
  return Number.isNaN(date.getTime()) ? null : date;
}

async function resolveMpesaConfig(shortcode) {
  if (!shortcode) return null;
  const code = String(shortcode).trim();
  if (!code) return null;

  const config = await PaymentConfig.findOne({
    provider: 'mpesa',
    $or: [{ paybillShortcode: code }, { buyGoodsTill: code }],
  }).lean();
  if (config) return config;

  const settings = await MpesaSettings.findOne({
    $or: [{ paybillShortcode: code }, { buyGoodsTill: code }],
  }).lean();
  if (!settings) return null;

  return {
    provider: 'mpesa',
    ispId: settings.ispId || null,
    businessName: settings.businessName || null,
    payMethod:
      settings.payMethod ||
      (settings.buyGoodsTill ? 'buygoods' : 'paybill'),
    environment: settings.environment || 'sandbox',
    paybillShortcode: settings.paybillShortcode || null,
    buyGoodsTill: settings.buyGoodsTill || null,
  };
}

function normalizeMsisdn(msisdn) {
  if (!msisdn) return null;
  const raw = String(msisdn).replace(/\D/g, '');
  if (/^0?7\d{8}$/.test(raw)) return `254${raw.slice(-9)}`;
  if (/^2547\d{8}$/.test(raw)) return raw;
  if (/^\+?2547\d{8}$/.test(raw)) return raw.replace('+', '');
  return null;
}

function createStatusError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function buildEventPatch(gatewayEvent, patch = {}) {
  return {
    tenantId: gatewayEvent?.tenantId || null,
    paymentId: gatewayEvent?.paymentId || null,
    sourcePath: gatewayEvent?.sourcePath || null,
    externalId: gatewayEvent?.externalId || null,
    externalRef: gatewayEvent?.externalRef || null,
    transactionId: gatewayEvent?.transactionId || null,
    accountNumber: gatewayEvent?.accountNumber || null,
    phoneNumber: gatewayEvent?.phoneNumber || null,
    amount: gatewayEvent?.amount ?? null,
    currency: gatewayEvent?.currency || null,
    resultCode: gatewayEvent?.resultCode ?? null,
    resultDesc: gatewayEvent?.resultDesc || null,
    matchedBy: gatewayEvent?.matchedBy || null,
    payload: gatewayEvent?.payload ?? null,
    headers: gatewayEvent?.headers ?? null,
    ...patch,
  };
}

const RESOLVABLE_EVENT_STATUSES = ['unmatched', 'failed', 'rejected'];
const RESOLUTION_PAYMENT_STATUSES = ['Pending', 'Failed'];

function isResolvableEventStatus(status) {
  return RESOLVABLE_EVENT_STATUSES.includes(String(status || '').toLowerCase());
}

async function loadResolutionPayment({
  tenantId,
  paymentId,
  expectedMethod,
  gatewayTransactionId = null,
}) {
  const payment = await Payment.findOne({
    _id: paymentId,
    tenantId,
    isDeleted: { $ne: true },
  }).populate('customer plan');

  if (!payment) {
    throw createStatusError(404, 'Target payment not found in tenant');
  }
  if (String(payment.method || '').toLowerCase() !== String(expectedMethod || '').toLowerCase()) {
    throw createStatusError(400, `Target payment must use ${expectedMethod}`);
  }
  if (!RESOLUTION_PAYMENT_STATUSES.includes(String(payment.status || ''))) {
    throw createStatusError(409, 'Target payment must be pending or failed before manual resolution');
  }
  if (
    gatewayTransactionId &&
    payment.transactionId &&
    String(payment.transactionId) !== String(gatewayTransactionId)
  ) {
    throw createStatusError(409, 'Target payment is already linked to a different transaction id');
  }
  return payment;
}

async function loadResolutionCustomer({ tenantId, customerId }) {
  const customer = await Customer.findOne({ _id: customerId, tenantId });
  if (!customer) {
    throw createStatusError(404, 'Target customer not found in tenant');
  }
  return customer;
}

async function runGatewayEventProcessing(gatewayEvent, options = {}) {
  const inProgress = await beginGatewayEventProcessing(gatewayEvent._id);
  try {
    await processGatewayEvent(inProgress, options);
  } catch (err) {
    await finalizeGatewayEvent(
      inProgress._id,
      buildEventPatch(inProgress, {
        eventStatus: 'failed',
        processingError: err?.message || String(err),
      })
    ).catch(() => {});
    throw err;
  }

  return PaymentGatewayEvent.findById(gatewayEvent._id).lean();
}

async function processStkGatewayEvent(gatewayEvent, options = {}) {
  const body = gatewayEvent?.payload;
  const stkCallback = body?.Body?.stkCallback;
  if (!stkCallback) {
    return finalizeGatewayEvent(
      gatewayEvent._id,
      buildEventPatch(gatewayEvent, {
        eventStatus: 'rejected',
        processingError: 'Invalid callback format',
      })
    );
  }

  const resultCode = Number(stkCallback.ResultCode);
  const resultDesc = stkCallback.ResultDesc || null;
  const callbackMetadata = Array.isArray(stkCallback.CallbackMetadata?.Item)
    ? stkCallback.CallbackMetadata.Item
    : [];
  const mpesaReceipt = callbackMetadata.find((item) => item?.Name === 'MpesaReceiptNumber')?.Value;
  const amount = callbackMetadata.find((item) => item?.Name === 'Amount')?.Value;
  const phone = callbackMetadata.find((item) => item?.Name === 'PhoneNumber')?.Value;
  const transactionDate = callbackMetadata.find((item) => item?.Name === 'TransactionDate')?.Value;
  const checkoutRequestId = stkCallback.CheckoutRequestID;
  const merchantRequestId = stkCallback.MerchantRequestID;
  const correlation = await findStkCorrelation({
    checkoutRequestId,
    merchantRequestId,
  });
  const touchCorrelation = async () => {
    await markStkCorrelationCallback({
      correlationId: correlation?._id || null,
      checkoutRequestId,
      merchantRequestId,
    }).catch(() => null);
  };

  const eventPatch = buildEventPatch(gatewayEvent, {
    tenantId: gatewayEvent.tenantId || correlation?.tenantId || null,
    paymentId: gatewayEvent.paymentId || correlation?.paymentId || null,
    externalId: checkoutRequestId || merchantRequestId || mpesaReceipt || gatewayEvent.externalId || null,
    externalRef: merchantRequestId || checkoutRequestId || gatewayEvent.externalRef || null,
    transactionId: mpesaReceipt || gatewayEvent.transactionId || null,
    accountNumber: gatewayEvent.accountNumber || correlation?.accountNumber || null,
    phoneNumber: phone ? String(phone) : gatewayEvent.phoneNumber || correlation?.phoneNumber || null,
    amount: Number.isFinite(Number(amount)) ? Number(amount) : gatewayEvent.amount,
    resultCode: Number.isFinite(resultCode) ? resultCode : gatewayEvent.resultCode,
    resultDesc: resultDesc || gatewayEvent.resultDesc || null,
  });

  let payment = null;
  let matchedBy = null;
  if (options.overridePaymentId) {
    payment = await loadResolutionPayment({
      tenantId: options.tenantId || gatewayEvent.tenantId,
      paymentId: options.overridePaymentId,
      expectedMethod: 'mpesa',
      gatewayTransactionId: mpesaReceipt || null,
    });
    matchedBy = 'manualPaymentId';
  }
  if (!payment && correlation?.paymentId) {
    payment = await Payment.findOne({
      _id: correlation.paymentId,
      tenantId: correlation.tenantId || undefined,
      isDeleted: { $ne: true },
    }).populate('customer plan');
    if (payment) matchedBy = 'stkCorrelation';
  }
  if (!payment && checkoutRequestId) {
    payment = await Payment.findOne({ checkoutRequestId }).populate('customer plan');
    if (payment) matchedBy = 'checkoutRequestId';
  }
  if (!payment && merchantRequestId) {
    payment = await Payment.findOne({ merchantRequestId }).populate('customer plan');
    if (payment) matchedBy = 'merchantRequestId';
  }
  if (!payment && phone && amount) {
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const candidates = await Payment.find({
      method: 'mpesa',
      status: 'Pending',
      phoneNumber: String(phone),
      amount: Number(amount),
      createdAt: { $gte: since },
    })
      .sort({ createdAt: -1 })
      .limit(2)
      .populate('customer plan');
    if (candidates.length === 1) {
      payment = candidates[0];
      matchedBy = 'phone+amount';
    }
  }

  if (!payment) {
    await touchCorrelation();
    return finalizeGatewayEvent(
      gatewayEvent._id,
      buildEventPatch(eventPatch, {
        eventStatus: 'unmatched',
        processingError: 'Payment not found for callback correlation ids',
      })
    );
  }

  if (!payment.checkoutRequestId && checkoutRequestId) payment.checkoutRequestId = checkoutRequestId;
  if (!payment.merchantRequestId && merchantRequestId) payment.merchantRequestId = merchantRequestId;

  if (resultCode === 0) {
    const paidAt = parseMpesaTimestamp(transactionDate) || new Date();
    payment.status = 'Success';
    if (mpesaReceipt) payment.transactionId = mpesaReceipt;
    if (amount) payment.amount = Number(amount);
    if (phone) payment.phoneNumber = String(phone);
    payment.validatedAt = paidAt;
    payment.validatedBy = 'mpesa-stk';
    payment.expiryDate =
      computeExpiryDate({
        plan: payment.plan,
        customerExpiryDate: payment.customer?.expiryDate || null,
        referenceDate: paidAt,
      }) || payment.expiryDate;
    await payment.save();
    await syncCustomerAccessFromPayments({
      tenantId: payment.tenantId,
      customerId: payment.customer?._id || payment.customer,
      debugId: `stk-${String(payment._id)}`,
    }).catch(() => {});
    await touchCorrelation();

    return finalizeGatewayEvent(
      gatewayEvent._id,
      buildEventPatch(eventPatch, {
        eventStatus: 'processed',
        tenantId: payment.tenantId,
        paymentId: payment._id,
        matchedBy,
        accountNumber: payment.accountNumber || null,
        phoneNumber: payment.phoneNumber || eventPatch.phoneNumber,
        transactionId: payment.transactionId || eventPatch.transactionId,
        amount: payment.amount,
        processingError: null,
      })
    );
  }

  payment.status = 'Failed';
  payment.validatedAt = new Date();
  payment.validatedBy = 'mpesa-stk';
  await payment.save();
  await touchCorrelation();

  return finalizeGatewayEvent(
    gatewayEvent._id,
    buildEventPatch(eventPatch, {
      eventStatus: 'processed',
      tenantId: payment.tenantId,
      paymentId: payment._id,
      matchedBy,
      accountNumber: payment.accountNumber || null,
      phoneNumber: payment.phoneNumber || eventPatch.phoneNumber,
      transactionId: payment.transactionId || eventPatch.transactionId,
      amount: payment.amount,
      processingError: null,
    })
  );
}

async function processC2bGatewayEvent(gatewayEvent, options = {}) {
  const payload = gatewayEvent?.payload || {};
  const {
    TransactionType,
    TransID,
    TransTime,
    TransAmount,
    BusinessShortCode,
    BillRefNumber,
    InvoiceNumber,
    ThirdPartyTransID,
    MSISDN,
    FirstName,
    MiddleName,
    LastName,
  } = payload;

  const config = await resolveMpesaConfig(BusinessShortCode);
  const basePatch = buildEventPatch(gatewayEvent, {
    tenantId: config?.ispId || gatewayEvent.tenantId || null,
    externalId: TransID || ThirdPartyTransID || InvoiceNumber || gatewayEvent.externalId || null,
    externalRef: InvoiceNumber || ThirdPartyTransID || gatewayEvent.externalRef || null,
    transactionId: TransID || gatewayEvent.transactionId || null,
    accountNumber: BillRefNumber ? String(BillRefNumber).trim() : gatewayEvent.accountNumber || null,
    phoneNumber: normalizeMsisdn(MSISDN) || gatewayEvent.phoneNumber || null,
    amount: Number.isFinite(Number(TransAmount)) ? Number(TransAmount) : gatewayEvent.amount,
  });

  if (!config && !options.overrideCustomerId) {
    return finalizeGatewayEvent(
      gatewayEvent._id,
      buildEventPatch(basePatch, {
        eventStatus: 'rejected',
        processingError: 'Shortcode not registered',
      })
    );
  }

  const accountRef = String(BillRefNumber || '').trim();
  const amount = Number(TransAmount);
  const msisdn = normalizeMsisdn(MSISDN);

  if (!accountRef && !options.overrideCustomerId) {
    return finalizeGatewayEvent(
      gatewayEvent._id,
      buildEventPatch(basePatch, {
        eventStatus: 'rejected',
        processingError: 'Missing account reference',
      })
    );
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return finalizeGatewayEvent(
      gatewayEvent._id,
      buildEventPatch(basePatch, {
        eventStatus: 'rejected',
        amount,
        processingError: 'Invalid amount',
      })
    );
  }

  let customer = null;
  if (options.overrideCustomerId) {
    customer = await loadResolutionCustomer({
      tenantId: options.tenantId || gatewayEvent.tenantId,
      customerId: options.overrideCustomerId,
    });
  }
  if (!customer && config?.ispId) {
    customer = await Customer.findOne({
      tenantId: config.ispId,
      accountNumber: accountRef,
    });
  }
  if (!customer) {
    customer = await Customer.findOne({ accountNumber: accountRef });
  }

  if (!customer) {
    return finalizeGatewayEvent(
      gatewayEvent._id,
      buildEventPatch(basePatch, {
        eventStatus: 'unmatched',
        processingError: 'Customer not found for account reference',
      })
    );
  }

  const tenantPatch = buildEventPatch(basePatch, {
    tenantId: customer.tenantId,
    accountNumber: customer.accountNumber || accountRef || basePatch.accountNumber,
    phoneNumber: msisdn || basePatch.phoneNumber,
    amount,
  });

  const existing = await Payment.findOne({
    tenantId: customer.tenantId,
    transactionId: TransID,
    method: 'mpesa',
  }).lean();
  if (existing) {
    return finalizeGatewayEvent(
      gatewayEvent._id,
      buildEventPatch(tenantPatch, {
        eventStatus: 'processed',
        paymentId: existing._id,
        matchedBy: options.overrideCustomerId ? 'manualCustomerId' : 'transactionId',
        processingError: null,
      })
    );
  }

  const planId = customer.plan;
  if (!planId) {
    return finalizeGatewayEvent(
      gatewayEvent._id,
      buildEventPatch(tenantPatch, {
        eventStatus: 'unmatched',
        processingError: 'Customer missing plan',
      })
    );
  }

  const plan = await Plan.findById(planId);
  if (!plan) {
    return finalizeGatewayEvent(
      gatewayEvent._id,
      buildEventPatch(tenantPatch, {
        eventStatus: 'unmatched',
        processingError: 'Plan not found',
      })
    );
  }

  const validatedAt = parseMpesaTimestamp(TransTime) || new Date();
  const payment = new Payment({
    tenantId: customer.tenantId,
    customer: customer._id,
    plan: plan._id,
    accountNumber: customer.accountNumber,
    phoneNumber: msisdn || null,
    amount,
    transactionId: TransID,
    method: 'mpesa',
    status: 'Success',
    validatedAt,
    validatedBy: 'mpesa-c2b',
    notes: `C2B ${TransactionType || ''}`.trim(),
    merchantRequestId: ThirdPartyTransID || null,
    checkoutRequestId: InvoiceNumber || null,
  });

  const expiry = computeExpiryDate({
    plan,
    customerExpiryDate: customer.expiryDate || null,
    referenceDate: validatedAt,
  });
  if (expiry) {
    payment.expiryDate = expiry;
    customer.expiryDate = expiry;
  }

  customer.status = 'active';
  if (FirstName || MiddleName || LastName) {
    const nameParts = [FirstName, MiddleName, LastName].filter(Boolean);
    if (!customer.name && nameParts.length) {
      customer.name = nameParts.join(' ');
    }
  }
  if (msisdn && !customer.phone) customer.phone = `+${msisdn}`;

  await payment.save();
  await customer.save().catch(() => {});
  await syncCustomerAccessFromPayments({
    tenantId: customer.tenantId,
    customerId: customer._id,
    debugId: `c2b-${String(payment._id)}`,
  }).catch(() => {});

    return finalizeGatewayEvent(
      gatewayEvent._id,
      buildEventPatch(tenantPatch, {
        eventStatus: 'processed',
        paymentId: payment._id,
        matchedBy: options.overrideCustomerId ? 'manualCustomerId' : 'transactionId',
        phoneNumber: payment.phoneNumber || tenantPatch.phoneNumber,
        amount: payment.amount,
        processingError: null,
    })
  );
}

async function processStripeGatewayEvent(gatewayEvent, options = {}) {
  const payload = gatewayEvent?.payload || null;
  const eventType = payload?.type || gatewayEvent?.eventType || null;
  const paymentIntent = payload?.data?.object || null;
  const metadataPaymentId = paymentIntent?.metadata?.paymentId || null;
  const metadataCustomerId = paymentIntent?.metadata?.customerId || null;
  let eventPatch = buildEventPatch(gatewayEvent, {
    externalId: payload?.id || gatewayEvent.externalId || null,
    externalRef: paymentIntent?.id || gatewayEvent.externalRef || null,
    transactionId: paymentIntent?.id || gatewayEvent.transactionId || null,
    amount:
      Number.isFinite(Number(paymentIntent?.amount_received))
        ? Number(paymentIntent.amount_received) / 100
        : Number.isFinite(Number(paymentIntent?.amount))
          ? Number(paymentIntent.amount) / 100
          : gatewayEvent.amount,
    currency: paymentIntent?.currency
      ? String(paymentIntent.currency).toUpperCase()
      : gatewayEvent.currency || null,
  });

  if (!eventPatch.tenantId && metadataPaymentId) {
    const metadataPayment = await Payment.findById(metadataPaymentId)
      .select({ tenantId: 1, accountNumber: 1, phoneNumber: 1, transactionId: 1 })
      .lean()
      .catch(() => null);
    if (metadataPayment?.tenantId) {
      eventPatch = buildEventPatch(eventPatch, {
        tenantId: metadataPayment.tenantId,
        paymentId: metadataPayment._id,
        accountNumber: metadataPayment.accountNumber || eventPatch.accountNumber,
        phoneNumber: metadataPayment.phoneNumber || eventPatch.phoneNumber,
        transactionId: metadataPayment.transactionId || eventPatch.transactionId,
      });
    }
  }

  if (!eventPatch.tenantId && metadataCustomerId) {
    const metadataCustomer = await Customer.findById(metadataCustomerId)
      .select({ tenantId: 1, accountNumber: 1, phone: 1 })
      .lean()
      .catch(() => null);
    if (metadataCustomer?.tenantId) {
      eventPatch = buildEventPatch(eventPatch, {
        tenantId: metadataCustomer.tenantId,
        accountNumber: metadataCustomer.accountNumber || eventPatch.accountNumber,
        phoneNumber: metadataCustomer.phone || eventPatch.phoneNumber,
      });
    }
  }

  if (!eventType) {
    return finalizeGatewayEvent(
      gatewayEvent._id,
      buildEventPatch(eventPatch, {
        eventStatus: 'rejected',
        processingError: 'Stripe event payload missing type',
      })
    );
  }

  if (eventType !== 'payment_intent.succeeded') {
    return finalizeGatewayEvent(
      gatewayEvent._id,
      buildEventPatch(eventPatch, {
        eventStatus: 'processed',
        processingError: null,
      })
    );
  }

  if (!paymentIntent?.id) {
    return finalizeGatewayEvent(
      gatewayEvent._id,
      buildEventPatch(eventPatch, {
        eventStatus: 'rejected',
        processingError: 'Stripe payment intent id missing from event payload',
      })
    );
  }

  let payment = null;
  let matchedBy = 'transactionId';
  if (options.overridePaymentId) {
    payment = await loadResolutionPayment({
      tenantId: options.tenantId || gatewayEvent.tenantId,
      paymentId: options.overridePaymentId,
      expectedMethod: 'stripe',
      gatewayTransactionId: paymentIntent.id,
    });
    matchedBy = 'manualPaymentId';
  }
  if (!payment && (gatewayEvent.paymentId || metadataPaymentId)) {
    payment = await Payment.findOne({
      _id: gatewayEvent.paymentId || metadataPaymentId,
      isDeleted: { $ne: true },
    }).populate('customer plan');
    if (payment) matchedBy = 'metadataPaymentId';
  }
  if (!payment) {
    payment = await Payment.findOne({ transactionId: paymentIntent.id }).populate('customer plan');
  }
  if (!payment) {
    return finalizeGatewayEvent(
      gatewayEvent._id,
      buildEventPatch(eventPatch, {
        eventStatus: 'unmatched',
        transactionId: paymentIntent.id,
        processingError: 'Payment record not found for Stripe PaymentIntent',
      })
    );
  }

  if (!payment.transactionId) {
    payment.transactionId = paymentIntent.id;
  }
  payment.status = 'Success';
  payment.validatedAt = new Date();
  payment.validatedBy = 'stripe-webhook';
  payment.expiryDate =
    computeExpiryDate({
      plan: payment.plan,
      customerExpiryDate: payment.customer?.expiryDate || null,
      referenceDate: payment.validatedAt,
    }) || payment.expiryDate;
  await payment.save();

  await syncCustomerAccessFromPayments({
    tenantId: payment.tenantId,
    customerId: payment.customer?._id || payment.customer,
    debugId: `stripe-${String(payment._id)}`,
  }).catch(() => {});

  return finalizeGatewayEvent(
    gatewayEvent._id,
    buildEventPatch(eventPatch, {
      eventStatus: 'processed',
      tenantId: payment.tenantId,
      paymentId: payment._id,
      matchedBy,
      accountNumber: payment.accountNumber || null,
      phoneNumber: payment.phoneNumber || null,
      amount: payment.amount,
      transactionId: payment.transactionId || paymentIntent.id || null,
      processingError: null,
    })
  );
}

async function processGatewayEvent(gatewayEvent, options = {}) {
  if (!gatewayEvent?._id) {
    throw createStatusError(400, 'Gateway event is required');
  }

  if (gatewayEvent.provider === 'mpesa' && gatewayEvent.kind === 'stk-callback') {
    return processStkGatewayEvent(gatewayEvent, options);
  }
  if (gatewayEvent.provider === 'mpesa' && gatewayEvent.kind === 'c2b-confirmation') {
    return processC2bGatewayEvent(gatewayEvent, options);
  }
  if (gatewayEvent.provider === 'stripe' && gatewayEvent.kind === 'webhook') {
    return processStripeGatewayEvent(gatewayEvent, options);
  }

  throw createStatusError(400, `Unsupported gateway event type: ${gatewayEvent.provider}/${gatewayEvent.kind}`);
}

async function retryGatewayEvent({ tenantId, eventId }) {
  const gatewayEvent = await PaymentGatewayEvent.findOne({ _id: eventId, tenantId });
  if (!gatewayEvent) {
    throw createStatusError(404, 'Payment gateway event not found');
  }

  if (!isResolvableEventStatus(gatewayEvent.eventStatus)) {
    throw createStatusError(409, 'Only unmatched, failed, or rejected events can be retried');
  }

  if (gatewayEvent.payload == null) {
    throw createStatusError(400, 'Cannot retry an event without stored payload');
  }

  return runGatewayEventProcessing(gatewayEvent, { tenantId });
}

async function resolveGatewayEvent({ tenantId, eventId, paymentId = null, customerId = null }) {
  const gatewayEvent = await PaymentGatewayEvent.findOne({ _id: eventId, tenantId });
  if (!gatewayEvent) {
    throw createStatusError(404, 'Payment gateway event not found');
  }

  if (!isResolvableEventStatus(gatewayEvent.eventStatus)) {
    throw createStatusError(409, 'Only unmatched, failed, or rejected events can be manually resolved');
  }
  if (gatewayEvent.payload == null) {
    throw createStatusError(400, 'Cannot resolve an event without stored payload');
  }

  const isPaymentResolution =
    (gatewayEvent.provider === 'mpesa' && gatewayEvent.kind === 'stk-callback') ||
    (gatewayEvent.provider === 'stripe' && gatewayEvent.kind === 'webhook');
  const isCustomerResolution =
    gatewayEvent.provider === 'mpesa' && gatewayEvent.kind === 'c2b-confirmation';

  if (isPaymentResolution) {
    if (!paymentId || customerId) {
      throw createStatusError(400, 'This event must be resolved to a payment');
    }
    return runGatewayEventProcessing(gatewayEvent, {
      tenantId,
      overridePaymentId: paymentId,
    });
  }

  if (isCustomerResolution) {
    if (!customerId || paymentId) {
      throw createStatusError(400, 'This event must be resolved to a customer');
    }
    return runGatewayEventProcessing(gatewayEvent, {
      tenantId,
      overrideCustomerId: customerId,
    });
  }

  throw createStatusError(400, 'Manual resolution is not supported for this gateway event type');
}

module.exports = {
  processGatewayEvent,
  retryGatewayEvent,
  resolveGatewayEvent,
};
