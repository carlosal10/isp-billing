// routes/payments.js
const express = require('express');
const router = express.Router();

const Payment = require('../models/Payment');
const Customer = require('../models/customers');
const Plan = require('../models/plan');
const { initiateSTKPush } = require('../utils/mpesa');
const { applyBandwidth } = require('../utils/mikrotikBandwidthManager');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// -------------------- STK Push --------------------
router.post('/stk', async (req, res) => {
  const { customerId, amount, phone, planId, callbackURL } = req.body;
  if (!customerId || !amount || !phone || !planId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const customer = await Customer.findById(customerId);
    const plan = await Plan.findById(planId);
    if (!customer || !plan) return res.status(404).json({ error: 'Invalid customer or plan' });

    const payment = await Payment.create({
      accountNumber: customer.accountNumber,
      phoneNumber: phone,
      customer: customer._id,
      plan: plan._id,
      amount,
      method: 'mpesa',
      status: 'Pending',
    });

    const stkResponse = await initiateSTKPush({
      ispId: customer._id,
      amount,
      phone,
      accountReference: payment._id.toString(),
      callbackURL,
    });

    res.json({ message: 'STK Push initiated', paymentId: payment._id, stkResponse });
  } catch (err) {
    console.error('stk error:', err);
    res.status(500).json({ error: 'STK Push failed' });
  }
});

// -------------------- Search (by customer/account) --------------------
// Frontend may use this to help pick a customer before manual validation.
//
// GET /api/payments/search?query=<name or accountNumber>
router.get('/search', async (req, res) => {
  const { query } = req.query;
  if (!query || !query.trim()) return res.json([]);

  try {
    const regex = new RegExp(query.trim(), 'i');

    // 1) Find matching customers (fast, indexable)
    const customers = await Customer.find(
      { $or: [{ name: regex }, { accountNumber: regex }] },
      { _id: 1, name: 1, accountNumber: 1 }
    )
      .limit(20)
      .lean();

    if (customers.length === 0) return res.json([]);

    // OPTIONAL: If you want to return customers (for your dropdown)
    // return res.json(customers);

    // 2) Or return recent payments for those customers (current behavior)
    const customerIds = customers.map((c) => c._id);
    const payments = await Payment.find({ customer: { $in: customerIds } })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('customer', 'name accountNumber')
      .populate('plan', 'name')
      .lean();

    const results = payments.map((p) => ({
      _id: p._id,
      accountNumber: p.accountNumber,
      customerName: p.customer?.name,
      amount: p.amount,
      method: p.method,
      status: p.status,
      createdAt: p.createdAt,
    }));

    res.json(results);
  } catch (err) {
    console.error('Payment search error:', err);
    res.status(500).json({ error: 'Failed to search payments' });
  }
});

// -------------------- Manual Validation --------------------
// Flexible:
//  A) Validate an existing payment: send { paymentId, transactionId, notes?, validatedBy? }
//  B) Create + validate new manual payment: send { customerId | accountNumber, transactionId, amount?, method?, notes?, validatedBy? }
//     - plan is taken from customer.plan; amount defaults to plan.price if not provided.
// -------------------- Manual Validation --------------------
router.post('/manual', async (req, res) => {
  const debugId = `manual-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  try {
    const {
      paymentId,           // Path A
      customerId,          // Path B
      accountNumber,       // Path B (optional)
      transactionId,       // common
      amount,              // optional, fallback to plan.price
      method,              // optional, default 'manual'
      notes,
      validatedBy,
    } = req.body || {};

    if (!transactionId || typeof transactionId !== 'string' || !transactionId.trim()) {
      return res.status(400).json({ error: 'transactionId is required', debugId });
    }

    // ---------- Path A: validate an existing payment ----------
    if (paymentId) {
      const payment = await Payment.findById(paymentId).populate('customer plan');
      if (!payment) return res.status(404).json({ error: 'Payment not found', debugId });
      if (!payment.plan) return res.status(400).json({ error: 'Payment has no plan associated', debugId });

      const durationDays = Number(payment.plan.duration);
      if (!Number.isFinite(durationDays) || durationDays <= 0) {
        return res.status(400).json({ error: 'Invalid plan duration on payment.plan', debugId });
      }

      payment.transactionId = transactionId.trim();
      payment.status = 'Success';
      payment.validatedBy = validatedBy || 'Manual Entry';
      payment.validatedAt = new Date();
      if (notes) payment.notes = notes;
      payment.expiryDate = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

      await payment.save();

      // Queue apply is best-effort
      try { await applyBandwidth(payment.customer, payment.plan); }
      catch (e) {
        console.warn(`[${debugId}] applyBandwidth failed:`, e?.message || e);
      }

      return res.json({ message: 'Payment validated', payment, debugId });
    }

    // ---------- Path B: create + validate new manual payment ----------
    // Find customer by customerId or accountNumber
    let customer = null;
    if (customerId) {
      customer = await Customer.findById(customerId).populate('plan');
    } else if (accountNumber) {
      customer = await Customer.findOne({ accountNumber }).populate('plan');
    } else {
      return res.status(400).json({ error: 'Provide customerId or accountNumber', debugId });
    }

    if (!customer) return res.status(404).json({ error: 'Customer not found', debugId });
    if (!customer.plan) return res.status(400).json({ error: 'Customer has no plan assigned', debugId });

    const plan = await Plan.findById(customer.plan._id);
    if (!plan) return res.status(400).json({ error: 'Invalid plan reference on customer', debugId });

    const priceNum = amount !== undefined && amount !== '' ? Number(amount) : Number(plan.price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return res.status(400).json({ error: 'Invalid amount (must be a number ≥ 0)', debugId });
    }

    const durationDays = Number(plan.duration);
    if (!Number.isFinite(durationDays) || durationDays <= 0) {
      return res.status(400).json({ error: 'Invalid plan.duration (must be a positive number of days)', debugId });
    }

    const payment = await Payment.create({
      accountNumber: customer.accountNumber,
      phoneNumber: customer.phone || undefined,
      customer: customer._id,
      plan: plan._id,
      amount: priceNum,
      method: method || 'manual',
      status: 'Success',
      transactionId: transactionId.trim(),
      validatedBy: validatedBy || 'Manual Entry',
      validatedAt: new Date(),
      expiryDate: new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000),
      ...(notes ? { notes } : {}),
    });

    try { await applyBandwidth(customer, plan); }
    catch (e) {
      console.warn(`[${debugId}] applyBandwidth failed:`, e?.message || e);
      // still succeed: payment is valid even if queue failed
    }

    return res.json({
      message: 'Manual payment created and validated',
      payment,
      debugId,
    });
  } catch (err) {
    console.error('[manual validation error]', debugId, err);
    return res.status(500).json({ error: 'Manual validation failed', debugId });
  }
});

// -------------------- Stripe Payment --------------------
router.post('/stripe/create', async (req, res) => {
  const { customerId, planId } = req.body;
  if (!customerId || !planId) return res.status(400).json({ error: 'Missing customerId or planId' });

  try {
    const customer = await Customer.findById(customerId);
    const plan = await Plan.findById(planId);
    if (!customer || !plan) return res.status(404).json({ error: 'Invalid customer or plan' });

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(plan.price * 100), // cents
      currency: 'kes', // adjust if your Stripe account doesn’t support KES
      metadata: { customerId: customer._id.toString(), planId: plan._id.toString() },
    });

    await Payment.create({
      accountNumber: customer.accountNumber,
      phoneNumber: customer.phone,
      customer: customer._id,
      plan: plan._id,
      amount: plan.price,
      method: 'stripe',
      status: 'Pending',
      transactionId: paymentIntent.id,
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('stripe create error:', err);
    res.status(500).json({ error: 'Stripe payment creation failed' });
  }
});

// -------------------- Stripe Webhook --------------------
// NOTE: mount this route BEFORE any global bodyParser.json() in your app
router.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      const payment = await Payment.findOne({ transactionId: paymentIntent.id }).populate('customer plan');
      if (payment) {
        payment.status = 'Success';
        payment.expiryDate = new Date(Date.now() + payment.plan.duration * 24 * 60 * 60 * 1000);
        await payment.save();
        await applyBandwidth(payment.customer, payment.plan);
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('stripe webhook handler error:', err);
    res.status(500).json({ error: 'Webhook handling failed' });
  }
});

// -------------------- Get all payments --------------------
router.get('/', async (_req, res) => {
  try {
    const payments = await Payment.find().lean();
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

module.exports = router;
