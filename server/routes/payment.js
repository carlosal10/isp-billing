'use strict';

const express = require('express');
const Payment = require('../models/Payment');
const AuditLog = require('../models/AuditLog');
const Customer = require('../models/customers');
const Plan = require('../models/plan');
const {
  searchPayments,
  listPayments,
  listGatewayEvents,
  getGatewayEvent,
} = require('../services/paymentReadService');
const requireRole = require('../middleware/requireRole');
const {
  retryGatewayEvent,
  resolveGatewayEvent,
} = require('../services/paymentGatewayProcessingService');
const {
  manualValidatePayment,
  adjustPayment,
  updatePaymentRecord,
  softDeletePayment,
  restorePaymentRecord,
} = require('../services/paymentWriteService');
const { upsertStkCorrelation } = require('../services/paymentGatewayCorrelationService');
const { initiateSTKPush } = require('../utils/mpesa');
const { normalizeMsisdn } = require('../utils/stkPush');

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

function requestActor(req) {
  return {
    id: String(req.user?.email || req.user?.sub || req.user?.id || req.user?._id || ''),
    email: req.user?.email || null,
    role: req.role || (req.user?.isPlatformAdmin ? 'platform-admin' : null),
  };
}

async function logGatewayAction(req, action, payload = {}) {
  if (!req.tenantId) return null;
  return AuditLog.create({
    tenantId: req.tenantId,
    actor: requestActor(req).id || requestActor(req).email || null,
    action,
    routerHost: null,
    payload,
  }).catch(() => null);
}

router.post('/stk', async (req, res) => {
  const { customerId, amount, phone, planId, callbackURL } = req.body || {};
  if (!customerId || !amount || !phone || !planId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const customer = await Customer.findOne({ _id: customerId, tenantId: req.tenantId });
    const plan = await Plan.findOne({ _id: planId, tenantId: req.tenantId });
    if (!customer || !plan) return res.status(404).json({ error: 'Invalid customer or plan' });

    const msisdn = normalizeMsisdn(phone);
    if (!msisdn) {
      console.warn('[payments:/stk] invalid phone format from client', {
        tenantId: String(req.tenantId),
        raw: String(phone),
      });
    }

    console.log('[payments:/stk] create pending payment', {
      tenantId: String(req.tenantId),
      customerId: String(customer._id),
      planId: String(plan._id),
      amount: Number(amount),
      phoneRaw: String(phone),
      phoneNorm: msisdn || null,
    });

    const payment = await Payment.create({
      tenantId: req.tenantId,
      accountNumber: customer.accountNumber,
      phoneNumber: msisdn || phone,
      customer: customer._id,
      plan: plan._id,
      amount,
      method: 'mpesa',
      status: 'Pending',
    });

    const apiBase = process.env.VITE_API_URL || '';
    const serverBase = apiBase.replace(/\/?api\/?$/, '');
    const cbUrl =
      callbackURL ||
      process.env.MPESA_CALLBACK_URL ||
      `${serverBase}/api/payment/callback/callback`;

    console.log('[payments:/stk] initiating STK push', {
      paymentId: String(payment._id),
      tenantId: String(req.tenantId),
      cbUrl,
      env: process.env.MPESA_ENV || 'sandbox',
    });

    const stkResponse = await initiateSTKPush({
      ispId: req.tenantId,
      amount,
      phone: msisdn || phone,
      accountReference: customer.accountNumber,
      callbackURL: cbUrl,
    });

    console.log('[payments:/stk] STK response', {
      paymentId: String(payment._id),
      MerchantRequestID: stkResponse?.MerchantRequestID,
      CheckoutRequestID: stkResponse?.CheckoutRequestID,
      ResponseCode: stkResponse?.ResponseCode,
      ResponseDescription: stkResponse?.ResponseDescription,
      CustomerMessage: stkResponse?.CustomerMessage,
    });

    try {
      const checkoutRequestId = stkResponse?.CheckoutRequestID;
      const merchantRequestId = stkResponse?.MerchantRequestID;
      if (checkoutRequestId || merchantRequestId) {
        await Payment.updateOne(
          { _id: payment._id },
          {
            $set: {
              checkoutRequestId: checkoutRequestId || undefined,
              merchantRequestId: merchantRequestId || undefined,
            },
          }
        );
        await upsertStkCorrelation({
          tenantId: req.tenantId,
          paymentId: payment._id,
          customerId: customer._id,
          planId: plan._id,
          accountNumber: customer.accountNumber || null,
          phoneNumber: msisdn || phone || null,
          amount: Number(amount),
          checkoutRequestId,
          merchantRequestId,
          source: 'payments:/stk',
          callbackUrl: cbUrl,
        }).catch((correlationError) => {
          console.warn('Could not persist STK correlation:', correlationError?.message || correlationError);
        });
        console.log('[payments:/stk] saved STK ids to payment', {
          paymentId: String(payment._id),
          CheckoutRequestID: checkoutRequestId || null,
          MerchantRequestID: merchantRequestId || null,
        });
      }
    } catch (e) {
      console.warn('Could not persist STK ids to payment:', e?.message || e);
    }

    return res.json({ message: 'STK Push initiated', paymentId: payment._id, stkResponse });
  } catch (err) {
    console.error('stk error:', {
      message: err?.message,
      darajaStatus: err?.darajaStatus || err?.response?.status || null,
      darajaResponse: err?.darajaResponse || err?.response?.data || null,
    });
    return res.status(500).json({ error: 'STK Push failed' });
  }
});

router.get('/search', async (req, res) => {
  try {
    const results = await searchPayments(req.tenantId, req.query?.query);
    return res.json(results);
  } catch (err) {
    console.error('Payment search error:', err);
    return res.status(500).json({ error: 'Failed to search payments' });
  }
});

router.get('/events', async (req, res) => {
  try {
    const events = await listGatewayEvents(req.tenantId, req.query);
    return res.json(events);
  } catch (err) {
    console.error('payment events list error:', err);
    return res.status(500).json({ error: 'Failed to fetch payment gateway events' });
  }
});

router.get('/events/:id', async (req, res) => {
  try {
    const event = await getGatewayEvent(req.tenantId, req.params.id);
    if (!event) {
      return res.status(404).json({ error: 'Payment gateway event not found' });
    }
    return res.json(event);
  } catch (err) {
    console.error('payment event detail error:', err);
    return res.status(500).json({ error: 'Failed to fetch payment gateway event detail' });
  }
});

router.post('/events/:id/retry', requireRole('owner', 'admin'), async (req, res) => {
  const note = typeof req.body?.note === 'string'
    ? req.body.note.trim() || null
    : null;
  const actor = requestActor(req);

  try {
    const before = await getGatewayEvent(req.tenantId, req.params.id);
    if (!before) {
      return res.status(404).json({ error: 'Payment gateway event not found' });
    }

    const event = await retryGatewayEvent({
      tenantId: req.tenantId,
      eventId: req.params.id,
    });

    await logGatewayAction(req, 'payment.gateway-event.retry', {
      ok: true,
      note,
      eventId: req.params.id,
      provider: before.provider || null,
      kind: before.kind || null,
      statusBefore: before.eventStatus || null,
      statusAfter: event?.eventStatus || null,
      actorRole: actor.role,
    });

    return res.json({ ok: true, event });
  } catch (err) {
    const status = Number(err?.statusCode) || 500;
    await logGatewayAction(req, 'payment.gateway-event.retry', {
      ok: false,
      note,
      eventId: req.params.id,
      error: err?.message || 'Failed to retry payment gateway event',
      actorRole: actor.role,
    });
    return res.status(status).json({ error: err?.message || 'Failed to retry payment gateway event' });
  }
});

router.post('/events/:id/resolve', requireRole('owner', 'admin'), async (req, res) => {
  const note = typeof req.body?.note === 'string'
    ? req.body.note.trim() || null
    : null;
  const paymentId = typeof req.body?.paymentId === 'string'
    ? req.body.paymentId.trim() || null
    : null;
  const customerId = typeof req.body?.customerId === 'string'
    ? req.body.customerId.trim() || null
    : null;
  const actor = requestActor(req);

  try {
    const before = await getGatewayEvent(req.tenantId, req.params.id);
    if (!before) {
      return res.status(404).json({ error: 'Payment gateway event not found' });
    }

    const event = await resolveGatewayEvent({
      tenantId: req.tenantId,
      eventId: req.params.id,
      paymentId,
      customerId,
    });

    await logGatewayAction(req, 'payment.gateway-event.resolve', {
      ok: true,
      note,
      eventId: req.params.id,
      provider: before.provider || null,
      kind: before.kind || null,
      statusBefore: before.eventStatus || null,
      statusAfter: event?.eventStatus || null,
      paymentId: paymentId || event?.paymentId || null,
      customerId: customerId || null,
      actorRole: actor.role,
    });

    return res.json({ ok: true, event });
  } catch (err) {
    const status = Number(err?.statusCode) || 500;
    await logGatewayAction(req, 'payment.gateway-event.resolve', {
      ok: false,
      note,
      eventId: req.params.id,
      paymentId: paymentId || null,
      customerId: customerId || null,
      error: err?.message || 'Failed to resolve payment gateway event',
      actorRole: actor.role,
    });
    return res.status(status).json({ error: err?.message || 'Failed to resolve payment gateway event' });
  }
});

router.post('/manual', async (req, res) => {
  try {
    const result = await manualValidatePayment({ tenantId: req.tenantId, payload: req.body });
    return res.json(result);
  } catch (err) {
    console.error('[manual validation error]', err?.debugId || 'manual-unknown', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message, debugId: err.debugId });
    }
    return res.status(500).json({ error: 'Manual validation failed', debugId: err?.debugId });
  }
});

router.post('/adjust', async (req, res) => {
  try {
    const result = await adjustPayment({ tenantId: req.tenantId, payload: req.body });
    return res.json(result);
  } catch (err) {
    console.error('[adjust payment error]', err?.debugId || 'adjust-unknown', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message, debugId: err.debugId });
    }
    return res.status(500).json({ error: 'Adjustment failed', debugId: err?.debugId });
  }
});

router.post('/stripe/create', async (req, res) => {
  const { customerId, planId } = req.body || {};
  if (!customerId || !planId) return res.status(400).json({ error: 'Missing customerId or planId' });

  try {
    const stripe = getStripeClient();
    const customer = await Customer.findOne({ _id: customerId, tenantId: req.tenantId });
    const plan = await Plan.findOne({ _id: planId, tenantId: req.tenantId });
    if (!customer || !plan) return res.status(404).json({ error: 'Invalid customer or plan' });

    const payment = new Payment({
      tenantId: req.tenantId,
      accountNumber: customer.accountNumber,
      phoneNumber: customer.phone,
      customer: customer._id,
      plan: plan._id,
      amount: Number(plan.price),
      method: 'stripe',
      status: 'Pending',
    });

    const metadata = {
      tenantId: String(req.tenantId),
      paymentId: String(payment._id),
      customerId: customer._id.toString(),
      planId: plan._id.toString(),
      accountNumber: customer.accountNumber ? String(customer.accountNumber) : '',
      customerEmail: customer.email ? String(customer.email) : '',
    };

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(Number(plan.price) * 100),
      currency: 'kes',
      metadata,
    });

    payment.transactionId = paymentIntent.id;
    await payment.save();

    return res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('stripe create error:', err);
    return res.status(500).json({ error: 'Stripe payment creation failed' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const result = await updatePaymentRecord({
      tenantId: req.tenantId,
      paymentId: req.params.id,
      payload: req.body,
    });
    return res.json(result);
  } catch (err) {
    console.error('payment update error:', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Failed to update payment' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await softDeletePayment({
      tenantId: req.tenantId,
      paymentId: req.params.id,
      payload: req.body,
    });
    return res.json(result);
  } catch (err) {
    console.error('payment delete error:', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Failed to delete payment' });
  }
});

router.patch('/:id/restore', async (req, res) => {
  try {
    const result = await restorePaymentRecord({
      tenantId: req.tenantId,
      paymentId: req.params.id,
    });
    return res.json(result);
  } catch (err) {
    console.error('payment restore error:', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Failed to restore payment' });
  }
});

router.get('/', async (req, res) => {
  try {
    const payments = await listPayments(req.tenantId, req.query);
    return res.json(payments);
  } catch (err) {
    console.error('payments list error:', err);
    return res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

module.exports = router;
