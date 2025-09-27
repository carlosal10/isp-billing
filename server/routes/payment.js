// routes/payments.js
'use strict';

const express = require('express');
const router = express.Router();

const Payment = require('../models/Payment');
const Customer = require('../models/customers');
const Plan = require('../models/plan');
const { initiateSTKPush } = require('../utils/mpesa');
const { applyCustomerQueue, enableCustomerQueue } = require('../utils/mikrotikBandwidthManager');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/*
  🔐 EXPECTED Payment schema extras (recommended):
  editedAt: Date,
  editedBy: String,
  editLog: [{ at: Date, by: String, changes: Object }],
  isDeleted: { type: Boolean, default: false },
  deletedAt: Date,
  deletedBy: String,
  deleteReason: String,
  expiryDate: Date,
  validatedAt: Date,
  validatedBy: String,
*/

// -------------------- Utilities --------------------
function safeNumber(v) {
  if (v === '' || v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

// Parse human-friendly durations into days
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

function diffAllowedFields(prev, next) {
  const changes = {};
  for (const k of ['transactionId','amount','method','notes','status','expiryDate']) {
    const a = prev[k];
    const b = next[k];
    // stringify dates for comparison
    const A = a instanceof Date ? a.toISOString() : a ?? '';
    const B = b instanceof Date ? b.toISOString() : b ?? '';
    if (B !== A) changes[k] = { from: a, to: b };
  }
  return changes;
}

// Recompute a customer's entitlement/status from non-deleted successful payments
async function recalcCustomerFromPayments({ tenantId, customerId }) {
  const payments = await Payment.find({
    tenantId,
    customer: customerId,
    isDeleted: { $ne: true },
    status: { $in: ['Success', 'Validated'] },
  })
    .populate('plan', 'duration durationDays')
    .lean();

  let maxExpiry = null;
  const now = Date.now();

  for (const p of payments) {
    const durationDays = Number.isFinite(p?.plan?.durationDays)
      ? p.plan.durationDays
      : parseDurationToDays(p?.plan?.duration);

    if (!Number.isFinite(durationDays) || durationDays <= 0) continue;

    const baseStart = p.validatedAt || p.createdAt;
    const computedExpiry = p.expiryDate
      ? new Date(p.expiryDate).getTime()
      : baseStart
      ? new Date(baseStart).getTime() + durationDays * 86400000
      : null;

    if (!computedExpiry) continue;
    if (maxExpiry == null || computedExpiry > maxExpiry) maxExpiry = computedExpiry;
  }

  const updates = {};
  if (maxExpiry && maxExpiry > now) {
    updates.status = 'active';
    updates.expiryDate = new Date(maxExpiry);
  } else {
    updates.status = 'inactive';
    if (maxExpiry) updates.expiryDate = new Date(maxExpiry);
    else updates.$unset = { expiryDate: 1 };
  }

  // Apply updates carefully (support $unset)
  if (updates.$unset) {
    await Customer.updateOne({ _id: customerId, tenantId }, { $set: { status: updates.status }, $unset: { expiryDate: '' } }).catch(() => {});
  } else {
    await Customer.updateOne({ _id: customerId, tenantId }, { $set: updates }).catch(() => {});
  }

  return updates;
}

// -------------------- STK Push --------------------
router.post('/stk', async (req, res) => {
  const { customerId, amount, phone, planId, callbackURL } = req.body || {};
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

// -------------------- Search (payments by customer/account) --------------------
// GET /api/payments/search?query=<name or accountNumber>
router.get('/search', async (req, res) => {
  const { query } = req.query || {};
  if (!query || !query.trim()) return res.json([]);

  try {
    const regex = new RegExp(query.trim(), 'i');

    const customers = await Customer.find(
      { tenantId: req.tenantId, $or: [{ name: regex }, { accountNumber: regex }] },
      { _id: 1, name: 1, accountNumber: 1 }
    ).limit(20).lean();

    if (customers.length === 0) return res.json([]);

    const customerIds = customers.map((c) => c._id);
    const payments = await Payment.find({ tenantId: req.tenantId, customer: { $in: customerIds }, isDeleted: { $ne: true } })
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
// A) Validate existing payment: { paymentId, transactionId, notes?, validatedBy? }
// B) Create+validate new payment: { customerId | accountNumber, transactionId, amount?, method?, notes?, validatedBy? }
router.post('/manual', async (req, res) => {
  const debugId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const {
      paymentId, customerId, accountNumber,
      transactionId, amount, method, notes, validatedBy,
    } = req.body || {};

    if (!transactionId || !String(transactionId).trim()) {
      return res.status(400).json({ error: 'transactionId is required', debugId });
    }

    // ---------- Path A: validate existing ----------
    if (paymentId) {
      const payment = await Payment.findOne({ _id: paymentId, tenantId: req.tenantId }).populate('customer plan');
      if (!payment) return res.status(404).json({ error: 'Payment not found', debugId });
      if (payment.isDeleted) return res.status(400).json({ error: 'Cannot validate a deleted payment', debugId });
      if (!payment.plan) return res.status(400).json({ error: 'Payment has no plan associated', debugId });

      const durationDays = (payment.plan.durationDays ?? parseDurationToDays(payment.plan.duration));
      if (!Number.isFinite(durationDays) || durationDays <= 0) {
        return res.status(400).json({ error: 'Invalid plan duration on payment.plan', debugId });
      }

      payment.transactionId = String(transactionId).trim();
      payment.status = 'Success';
      payment.validatedBy = validatedBy || 'Manual Entry';
      payment.validatedAt = new Date();
      if (notes) payment.notes = notes;
      payment.expiryDate = new Date(Date.now() + durationDays * 86400000);

      try {
        await payment.save();
      } catch (e) {
        if (e?.code === 11000 && e?.keyPattern?.transactionId) {
          return res.status(409).json({ error: 'Duplicate transactionId for this tenant', debugId });
        }
        throw e;
      }

      try {
        const customerDoc = payment.customer;
        const planDoc = payment.plan;
        if (customerDoc) {
          await Customer.updateOne({ _id: customerDoc._id, tenantId: req.tenantId }, { $set: { status: 'active', expiryDate: payment.expiryDate } });
          if (customerDoc.connectionType === 'static') {
            await enableCustomerQueue(customerDoc, planDoc).catch(() => {});
          } else {
            await applyCustomerQueue(customerDoc, planDoc).catch(() => {});
          }
        }
      } catch (e) {
        console.warn(`[${debugId}] queue sync failed:`, e?.message || e);
      }

      return res.json({ message: 'Payment validated', payment, debugId });
    }

    // ---------- Path B: create + validate ----------
    let customer = null;
    if (customerId) customer = await Customer.findOne({ _id: customerId, tenantId: req.tenantId }).populate('plan');
    else if (accountNumber) customer = await Customer.findOne({ accountNumber, tenantId: req.tenantId }).populate('plan');
    else return res.status(400).json({ error: 'Provide customerId or accountNumber', debugId });

    if (!customer) return res.status(404).json({ error: 'Customer not found', debugId });
    if (!customer.plan) return res.status(400).json({ error: 'Customer has no plan assigned', debugId });

    const plan = (await Plan.findOne({ _id: customer.plan._id, tenantId: req.tenantId })) || customer.plan;

    const priceNum = amount !== undefined && amount !== '' ? safeNumber(amount) : safeNumber(plan.price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return res.status(400).json({ error: 'Invalid amount (must be a number ≥ 0)', debugId });
    }

    const durationDays = (plan.durationDays ?? parseDurationToDays(plan.duration));
    if (!Number.isFinite(durationDays) || durationDays <= 0) {
      return res.status(400).json({ error: 'Invalid plan.duration (must be days > 0)', debugId });
    }

    const doc = new Payment({
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
      expiryDate: new Date(Date.now() + durationDays * 86400000),
      ...(notes ? { notes } : {}),
    });

    try {
      await doc.save();
    } catch (e) {
      if (e?.code === 11000 && e?.keyPattern?.transactionId) {
        return res.status(409).json({ error: 'Duplicate transactionId for this tenant', debugId });
      }
      throw e;
    }

    try {
      await Customer.updateOne(
        { _id: customer._id, tenantId: req.tenantId },
        { $set: { status: 'active', expiryDate: doc.expiryDate } }
      ).catch(() => {});
      if (customer.connectionType === 'static') {
        await enableCustomerQueue(customer, plan).catch(() => {});
      } else {
        await applyCustomerQueue(customer, plan).catch(() => {});
      }
    } catch (e) {
      console.warn(`[${debugId}] queue sync failed:`, e?.message || e);
    }

    return res.json({ message: 'Manual payment created and validated', payment: doc, debugId });
  } catch (err) {
    console.error('[manual validation error]', debugId, err);
    return res.status(500).json({ error: 'Manual validation failed', debugId });
  }
});

// -------------------- Stripe Payment --------------------
router.post('/stripe/create', async (req, res) => {
  const { customerId, planId } = req.body || {};
  if (!customerId || !planId) return res.status(400).json({ error: 'Missing customerId or planId' });

  try {
    const customer = await Customer.findOne({ _id: customerId, tenantId: req.tenantId });
    const plan = await Plan.findOne({ _id: planId, tenantId: req.tenantId });
    if (!customer || !plan) return res.status(404).json({ error: 'Invalid customer or plan' });

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(Number(plan.price) * 100),
      currency: 'kes', // adjust if your Stripe account doesn’t support KES
      metadata: { customerId: customer._id.toString(), planId: plan._id.toString() },
    });

    await Payment.create({
      tenantId: req.tenantId,
      accountNumber: customer.accountNumber,
      phoneNumber: customer.phone,
      customer: customer._id,
      plan: plan._id,
      amount: Number(plan.price),
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

// -------------------- Update (Edit) Payment --------------------
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { transactionId, amount, method, notes, status, expiryDate, editedBy } = req.body || {};

    const payment = await Payment.findOne({ _id: id, tenantId: req.tenantId });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (payment.isDeleted) return res.status(400).json({ error: 'Cannot edit a deleted payment' });

    const before = payment.toObject();

    if (transactionId !== undefined) payment.transactionId = String(transactionId).trim();
    if (amount !== undefined) {
      if (amount === '') {
        // allow clearing? typically no. choose to ignore for safety
      } else {
        const num = safeNumber(amount);
        if (!Number.isFinite(num) || num < 0) return res.status(400).json({ error: 'Invalid amount' });
        payment.amount = num;
      }
    }
    if (method !== undefined) payment.method = String(method).trim() || payment.method;
    if (notes !== undefined) payment.notes = String(notes);
    if (status !== undefined) payment.status = String(status);
    if (expiryDate !== undefined) {
      const d = expiryDate ? new Date(expiryDate) : null;
      if (d && isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid expiryDate' });
      payment.expiryDate = d || payment.expiryDate;
    }

    payment.editedAt = new Date();
    payment.editedBy = editedBy || 'Admin Panel';

    const changes = diffAllowedFields(before, payment.toObject());
    if (Object.keys(changes).length) {
      payment.editLog = payment.editLog || [];
      payment.editLog.push({ at: new Date(), by: payment.editedBy, changes });
    }

    try {
      await payment.save();
    } catch (e) {
      if (e?.code === 11000 && e?.keyPattern?.transactionId) {
        return res.status(409).json({ error: 'Duplicate transactionId for this tenant' });
      }
      throw e;
    }

    const impactful = ['amount','status','transactionId','method','expiryDate'].some(k => changes[k]);
    if (impactful && payment.customer) {
      await recalcCustomerFromPayments({ tenantId: req.tenantId, customerId: payment.customer });
    }

    return res.json({ ok: true, payment });
  } catch (err) {
    console.error('payment update error:', err);
    return res.status(500).json({ error: 'Failed to update payment' });
  }
});

// -------------------- Delete (Soft) Payment --------------------
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, deletedBy } = req.body || {};

    const payment = await Payment.findOne({ _id: id, tenantId: req.tenantId });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (payment.isDeleted) return res.json({ ok: true, message: 'Already deleted' });

    payment.isDeleted = true;
    payment.deletedAt = new Date();
    payment.deletedBy = deletedBy || 'Admin Panel';
    payment.deleteReason = reason || 'Removed via UI';

    await payment.save();

    if (payment.customer) {
      await recalcCustomerFromPayments({ tenantId: req.tenantId, customerId: payment.customer });
    }

    return res.json({ ok: true, message: 'Payment deleted' });
  } catch (err) {
    console.error('payment delete error:', err);
    return res.status(500).json({ error: 'Failed to delete payment' });
  }
});

// -------------------- Restore a soft-deleted payment --------------------
router.patch('/:id/restore', async (req, res) => {
  try {
    const { id } = req.params;

    const payment = await Payment.findOne({ _id: id, tenantId: req.tenantId });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (!payment.isDeleted) return res.json({ ok: true, message: 'Payment is not deleted' });

    payment.isDeleted = false;
    payment.deletedAt = undefined;
    payment.deletedBy = undefined;
    payment.deleteReason = undefined;

    await payment.save();

    if (payment.customer) {
      await recalcCustomerFromPayments({ tenantId: req.tenantId, customerId: payment.customer });
    }

    return res.json({ ok: true, message: 'Payment restored', payment });
  } catch (err) {
    console.error('payment restore error:', err);
    return res.status(500).json({ error: 'Failed to restore payment' });
  }
});

// -------------------- Get all payments --------------------
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const includeDeleted = /^(1|true|yes)$/i.test(String(req.query.includeDeleted || ''));
    const filter = { tenantId: req.tenantId };
    if (!includeDeleted) filter.isDeleted = { $ne: true };

    const payments = await Payment.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('customer', 'name accountNumber connectionType')
      .populate('plan', 'name price duration durationDays')
      .lean();

    const shaped = payments.map((p) => ({
      ...p,
      customerName: p.customer?.name || null,
      accountNumber: p.accountNumber || p.customer?.accountNumber || null,
    }));

    res.json(shaped);
  } catch (err) {
    console.error('payments list error:', err);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

module.exports = router;
