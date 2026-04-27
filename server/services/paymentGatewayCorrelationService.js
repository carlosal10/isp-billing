'use strict';

const PaymentGatewayCorrelation = require('../models/PaymentGatewayCorrelation');

async function upsertStkCorrelation({
  tenantId,
  paymentId,
  customerId = null,
  planId = null,
  accountNumber = null,
  phoneNumber = null,
  amount = null,
  checkoutRequestId = null,
  merchantRequestId = null,
  source = null,
  callbackUrl = null,
}) {
  if (!tenantId || !paymentId) return null;
  if (!checkoutRequestId && !merchantRequestId) return null;

  const base = {
    provider: 'mpesa',
    kind: 'stk-push',
    tenantId,
    paymentId,
    customerId: customerId || null,
    planId: planId || null,
    accountNumber: accountNumber || null,
    phoneNumber: phoneNumber || null,
    amount: Number.isFinite(Number(amount)) ? Number(amount) : null,
    checkoutRequestId: checkoutRequestId || null,
    merchantRequestId: merchantRequestId || null,
    source: source || null,
    callbackUrl: callbackUrl || null,
  };

  const selector = checkoutRequestId
    ? { provider: 'mpesa', checkoutRequestId }
    : { provider: 'mpesa', merchantRequestId };

  return PaymentGatewayCorrelation.findOneAndUpdate(
    selector,
    {
      $set: base,
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  );
}

async function findStkCorrelation({ checkoutRequestId = null, merchantRequestId = null }) {
  if (checkoutRequestId) {
    const byCheckout = await PaymentGatewayCorrelation.findOne({
      provider: 'mpesa',
      checkoutRequestId,
    }).lean();
    if (byCheckout) return byCheckout;
  }

  if (merchantRequestId) {
    return PaymentGatewayCorrelation.findOne({
      provider: 'mpesa',
      merchantRequestId,
    }).lean();
  }

  return null;
}

async function markStkCorrelationCallback({ correlationId = null, checkoutRequestId = null, merchantRequestId = null }) {
  const selector = correlationId
    ? { _id: correlationId }
    : checkoutRequestId
      ? { provider: 'mpesa', checkoutRequestId }
      : merchantRequestId
        ? { provider: 'mpesa', merchantRequestId }
        : null;

  if (!selector) return null;

  return PaymentGatewayCorrelation.findOneAndUpdate(
    selector,
    {
      $set: {
        consumedAt: new Date(),
        lastCallbackAt: new Date(),
      },
    },
    { new: true }
  ).lean();
}

module.exports = {
  upsertStkCorrelation,
  findStkCorrelation,
  markStkCorrelationCallback,
};
