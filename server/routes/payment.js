const express = require('express');
const router = express.Router();
const Payment = require('../models/Payment');
const Customer = require('../models/customers');
const Plan = require('../models/plan');
const { initiateSTKPush } = require('../utils/mpesa');
const { applyBandwidth } = require('../utils/mikrotikBandwidthManager'); // your queue logic
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// -------------------- STK Push --------------------
router.post('/stk', async (req, res) => {
    const { customerId, amount, phone, planId, callbackURL } = req.body;

    if (!customerId || !amount || !phone || !planId) 
        return res.status(400).json({ error: 'Missing required fields' });

    try {
        const customer = await Customer.findById(customerId);
        const plan = await Plan.findById(planId);
        if (!customer || !plan) return res.status(404).json({ error: 'Invalid customer or plan' });

        // Record pending payment
        const payment = await Payment.create({
            accountNumber: customer.accountNumber,
            phoneNumber: phone,
            customer: customer._id,
            plan: plan._id,
            amount,
            method: 'mpesa',
            status: 'Pending'
        });

        const stkResponse = await initiateSTKPush({ ispId: customer._id, amount, phone, accountReference: payment._id.toString(), callbackURL });

        res.json({ message: 'STK Push initiated', paymentId: payment._id, stkResponse });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'STK Push failed' });
    }
});
// GET /api/payments/search?query=...
router.get('/search', async (req, res) => {
  const { query } = req.query;

  if (!query) return res.status(400).json({ error: 'Query parameter is required' });

  try {
    // Search by accountNumber or customer name
    const payments = await Payment.find()
      .populate('customer plan')
      .or([
        { accountNumber: { $regex: query, $options: 'i' } },
        { 'customer.name': { $regex: query, $options: 'i' } }
      ])
      .limit(50); // optional: limit results

    // Map to frontend-friendly format
    const results = payments.map(p => ({
      _id: p._id,
      accountNumber: p.accountNumber,
      customerName: p.customer.name,
      amount: p.amount,
      method: p.method,
      status: p.status,
      createdAt: p.createdAt
    }));

    res.json(results);
  } catch (err) {
    console.error('Payment search error:', err);
    res.status(500).json({ error: 'Failed to search payments' });
  }
});


// // -------------------- Manual Validation --------------------
router.post('/manual', async (req, res) => {
  const { paymentId, transactionId, notes, validatedBy } = req.body; 
  // validatedBy = string (admin name) for now

  if (!paymentId || !transactionId) {
    return res.status(400).json({ error: 'Missing paymentId or transactionId' });
  }

  try {
    const payment = await Payment.findById(paymentId).populate('customer plan');
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    // ✅ Update payment
    payment.transactionId = transactionId;
    payment.status = 'Success';
    payment.expiryDate = new Date(
      Date.now() + payment.plan.duration * 24 * 60 * 60 * 1000
    );

    // ✅ Manual validation audit trail
    payment.validatedBy = validatedBy || 'Manual Entry';
    payment.validatedAt = new Date();
    if (notes) payment.notes = notes;

    await payment.save();

    // ✅ Apply bandwidth / queue logic
    await applyBandwidth(payment.customer, payment.plan);

    res.json({
      message: 'Payment manually validated and bandwidth applied',
      payment,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Manual validation failed' });
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
            amount: plan.price * 100, // Stripe uses cents
            currency: 'kes',
            metadata: { customerId: customer._id.toString(), planId: plan._id.toString() },
        });

        // Record pending payment
        await Payment.create({
            accountNumber: customer.accountNumber,
            phoneNumber: customer.phone,
            customer: customer._id,
            plan: plan._id,
            amount: plan.price,
            method: 'stripe',
            status: 'Pending',
            transactionId: paymentIntent.id
        });

        res.json({ clientSecret: paymentIntent.client_secret });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Stripe payment creation failed' });
    }
});

// -------------------- Stripe Webhook --------------------
router.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

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
});

module.exports = router;
