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
    const customer = await Customer.findOne({ _id: customerId, tenantId: req.tenantId });
    const plan = await Plan.findOne({ _id: planId, tenantId: req.tenantId });
    if (!customer || !plan) return res.status(404).json({ error: 'Invalid customer or plan' });

    const payment = await Payment.create({
      tenantId: req.tenantId,
      accountNumber: customer.accountNumber,
      phoneNumber: phone,
      customer: customer._id,
      plan: plan._id,
      amount,
      method: 'mpesa',
      status: 'Pending',
    });

    const stkResponse = await initiateSTKPush({
      ispId: req.tenantId,
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
      { tenantId: req.tenantId, $or: [{ name: regex }, { accountNumber: regex }] },
      { _id: 1, name: 1, accountNumber: 1 }
    )
      .limit(20)
      .lean();

    if (customers.length === 0) return res.json([]);

    // OPTIONAL: If you want to return customers (for your dropdown)
    // return res.json(customers);

    // 2) Or return recent payments for those customers (current behavior)
    const customerIds = customers.map((c) => c._id);
    const payments = await Payment.find({ tenantId: req.tenantId, customer: { $in: customerIds } })
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
// Helper: parse human-friendly durations into days
function parseDurationToDays(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  const s = String(v).trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = s.match(/(\d+(\.\d+)?)\s*(day|week|month|year)s?/);
  if (m) {
    const n = parseFloat(m[1]);
    const u = m[3];
    if (u === 'day') return n;
    if (u === 'week') return n * 7;
    if (u === 'month') return n * 30;
    if (u === 'year') return n * 365;
  }
  if (s === 'monthly' || s === 'month') return 30;
  if (s === 'weekly' || s === 'week') return 7;
  if (s === 'yearly' || s === 'annual' || s === 'year') return 365;
  const num = parseFloat(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(num) ? num : NaN;
}

// Flexible:
//  A) Validate existing payment: { paymentId, transactionId, notes?, validatedBy? }
//  B) Create+validate new payment: { customerId | accountNumber, transactionId, amount?, method?, notes?, validatedBy? }
router.post('/manual', async (req, res) => {
  const debugId = `manual-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  try {
    const {
      paymentId, customerId, accountNumber,
      transactionId, amount, method, notes, validatedBy,
    } = req.body || {};

    if (!transactionId || !String(transactionId).trim()) {
      return res.status(400).json({ error: 'transactionId is required', debugId });
    }

    // ---------- Path A ----------
    if (paymentId) {
      const payment = await Payment.findOne({ _id: paymentId, tenantId: req.tenantId }).populate('customer plan');
      if (!payment) return res.status(404).json({ error: 'Payment not found', debugId });
      if (!payment.plan) return res.status(400).json({ error: 'Payment has no plan associated', debugId });

      const durationDays =
        (payment.plan.durationDays ?? parseDurationToDays(payment.plan.duration));

      if (!Number.isFinite(durationDays) || durationDays <= 0) {
        return res.status(400).json({ error: 'Invalid plan duration on payment.plan', debugId });
      }

      payment.transactionId = String(transactionId).trim();
      payment.status = 'Success';
      payment.validatedBy = validatedBy || 'Manual Entry';
      payment.validatedAt = new Date();
      if (notes) payment.notes = notes;
      payment.expiryDate = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

      await payment.save();

      try { await applyBandwidth(payment.customer, payment.plan); }
      catch (e) { console.warn(`[${debugId}] applyBandwidth failed:`, e?.message || e); }

      return res.json({ message: 'Payment validated', payment, debugId });
    }

    // ---------- Path B ----------
    let customer = null;
    if (customerId) customer = await Customer.findOne({ _id: customerId, tenantId: req.tenantId }).populate('plan');
    else if (accountNumber) customer = await Customer.findOne({ accountNumber, tenantId: req.tenantId }).populate('plan');
    else return res.status(400).json({ error: 'Provide customerId or accountNumber', debugId });

    if (!customer) return res.status(404).json({ error: 'Customer not found', debugId });
    if (!customer.plan) return res.status(400).json({ error: 'Customer has no plan assigned', debugId });

    // If you already populated a full plan doc above, you can use it directly:
    // const plan = customer.plan;
    // If you prefer a fresh fetch, keep this:
    const plan = (await Plan.findOne({ _id: customer.plan._id, tenantId: req.tenantId })) || customer.plan;

    const priceNum = (amount !== undefined && amount !== '')
      ? Number(amount)
      : Number(plan.price);

    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return res.status(400).json({ error: 'Invalid amount (must be a number ≥ 0)', debugId });
    }

    const durationDays =
      (plan.durationDays ?? parseDurationToDays(plan.duration));

    if (!Number.isFinite(durationDays) || durationDays <= 0) {
      return res.status(400).json({ error: 'Invalid plan.duration (must be a positive number of days)', debugId });
    }

    const payment = await Payment.create({
      tenantId: req.tenantId,
      accountNumber: customer.accountNumber,
      phoneNumber: customer.phone || undefined,
      customer: customer._id,
      plan: plan._id,
      amount: priceNum,
      method: method || 'manual',
      status: 'Success',
      transactionId: String(transactionId).trim(),
      validatedBy: validatedBy || 'Manual Entry',
      validatedAt: new Date(),
      expiryDate: new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000),
      ...(notes ? { notes } : {}),
    });

    try { await applyBandwidth(customer, plan); }
    catch (e) { console.warn(`[${debugId}] applyBandwidth failed:`, e?.message || e); }

    return res.json({ message: 'Manual payment created and validated', payment, debugId });
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
    const customer = await Customer.findOne({ _id: customerId, tenantId: req.tenantId });
    const plan = await Plan.findOne({ _id: planId, tenantId: req.tenantId });
    if (!customer || !plan) return res.status(404).json({ error: 'Invalid customer or plan' });

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(plan.price * 100), // cents
      currency: 'kes', // adjust if your Stripe account doesn’t support KES
      metadata: { customerId: customer._id.toString(), planId: plan._id.toString() },
    });

    await Payment.create({
      tenantId: req.tenantId,
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

// Stripe webhook is mounted separately at /api/payment/stripe/webhook with raw body

/// -------------------- Get all payments --------------------
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const payments = await Payment.find({ tenantId: req.tenantId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('customer', 'name accountNumber') // <-- get the name
      .populate('plan', 'name price')              // (optional) plan info
      .lean();

    // add a flat customerName for the frontend fallback
    const shaped = payments.map(p => ({
      ...p,
      customerName: p.customer?.name || null,
      // keep a safe account number too (frontend can show when name missing)
      accountNumber: p.accountNumber || p.customer?.accountNumber || null,
    }));

    res.json(shaped);
  } catch (err) {
    console.error('payments list error:', err);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});


module.exports = router;
