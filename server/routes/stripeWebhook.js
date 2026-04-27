'use strict';

const express = require('express');
const Payment = require('../models/Payment');
const Customer = require('../models/customers');
const {
  hashValue,
  buildHeaderSnapshot,
  recordGatewayEvent,
  beginGatewayEventProcessing,
  finalizeGatewayEvent,
  shouldSkipDuplicate,
} = require('../services/paymentGatewayEventService');
const { processGatewayEvent } = require('../services/paymentGatewayProcessingService');

const router = express.Router();

let stripeClient = null;
function getStripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  if (!stripeClient) {
    stripeClient = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

async function deriveStripeGatewayContext(payload = null) {
  const paymentIntent = payload?.data?.object || null;
  const metadata = paymentIntent?.metadata || {};
  const amountCents =
    Number.isFinite(Number(paymentIntent?.amount_received))
      ? Number(paymentIntent.amount_received)
      : Number.isFinite(Number(paymentIntent?.amount))
        ? Number(paymentIntent.amount)
        : null;

  const patch = {
    eventType: payload?.type || null,
    externalId: payload?.id || null,
    externalRef: paymentIntent?.id || null,
    transactionId: paymentIntent?.id || null,
    currency: paymentIntent?.currency ? String(paymentIntent.currency).toUpperCase() : null,
    amount: amountCents == null ? null : amountCents / 100,
    accountNumber:
      typeof metadata.accountNumber === 'string' && metadata.accountNumber.trim()
        ? metadata.accountNumber.trim()
        : null,
  };

  const metadataPaymentId =
    typeof metadata.paymentId === 'string' && metadata.paymentId.trim()
      ? metadata.paymentId.trim()
      : null;
  if (metadataPaymentId) {
    const payment = await Payment.findById(metadataPaymentId)
      .select({ tenantId: 1, accountNumber: 1, phoneNumber: 1 })
      .lean()
      .catch(() => null);
    if (payment?.tenantId) {
      return {
        ...patch,
        tenantId: payment.tenantId,
        paymentId: payment._id,
        accountNumber: payment.accountNumber || patch.accountNumber,
        phoneNumber: payment.phoneNumber || null,
      };
    }
  }

  const metadataCustomerId =
    typeof metadata.customerId === 'string' && metadata.customerId.trim()
      ? metadata.customerId.trim()
      : null;
  if (metadataCustomerId) {
    const customer = await Customer.findById(metadataCustomerId)
      .select({ tenantId: 1, accountNumber: 1, phone: 1 })
      .lean()
      .catch(() => null);
    if (customer?.tenantId) {
      return {
        ...patch,
        tenantId: customer.tenantId,
        accountNumber: customer.accountNumber || patch.accountNumber,
        phoneNumber: customer.phone || null,
      };
    }
  }

  return patch;
}

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const headers = buildHeaderSnapshot(req.headers);
  const rawBodyText = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  let parsedPayload = null;
  try {
    parsedPayload = rawBodyText ? JSON.parse(rawBodyText) : null;
  } catch {}

  let event = null;
  let gatewayEvent = null;
  let gatewayEventMeta = null;

  try {
    const stripe = getStripeClient();
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    const derivedContext = await deriveStripeGatewayContext(parsedPayload).catch(() => ({}));
    const rejectedDedupeKey = parsedPayload?.id
      ? `stripe:webhook:${parsedPayload.id}`
      : `stripe:webhook:invalid:${hashValue(rawBodyText)}`;
    const recorded = await recordGatewayEvent({
      provider: 'stripe',
      kind: 'webhook',
      eventType: parsedPayload?.type || null,
      dedupeKey: rejectedDedupeKey,
      eventStatus: 'rejected',
      sourcePath: req.originalUrl,
      externalId: parsedPayload?.id || null,
      ...derivedContext,
      headers,
      payload: parsedPayload || { rawBody: rawBodyText },
      processingError: err.message,
    }).catch(() => null);
    if (recorded?.event?._id) {
      await finalizeGatewayEvent(recorded.event._id, {
        provider: 'stripe',
        kind: 'webhook',
        eventType: parsedPayload?.type || null,
        eventStatus: 'rejected',
        sourcePath: req.originalUrl,
        externalId: parsedPayload?.id || null,
        ...derivedContext,
        headers,
        payload: parsedPayload || { rawBody: rawBodyText },
        processingError: err.message,
      }).catch(() => {});
    }
    console.error('Stripe Webhook Error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const derivedContext = await deriveStripeGatewayContext(parsedPayload || event).catch(() => ({}));
    gatewayEventMeta = {
      provider: 'stripe',
      kind: 'webhook',
      eventType: event.type,
      dedupeKey: `stripe:webhook:${event.id || hashValue(rawBodyText)}`,
      sourcePath: req.originalUrl,
      externalId: event.id || null,
      ...derivedContext,
      headers,
      payload: parsedPayload || event,
    };
    const recorded = await recordGatewayEvent(gatewayEventMeta);
    gatewayEvent = recorded.event;
    if (recorded.isDuplicate && shouldSkipDuplicate(gatewayEvent)) {
      return res.json({ received: true });
    }
    gatewayEvent = await beginGatewayEventProcessing(gatewayEvent._id);

    await processGatewayEvent(gatewayEvent);
    return res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook processing failed:', err);
    if (gatewayEvent?._id) {
      await finalizeGatewayEvent(gatewayEvent._id, {
        ...(gatewayEventMeta || {}),
        eventStatus: 'failed',
        processingError: err?.message || String(err),
      }).catch(() => {});
    }
    return res.status(500).send('Internal webhook error');
  }
});

module.exports = router;
