// routes/stripeWebhook.js
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Payment = require('../models/Payment');
const { applyCustomerQueue, enableCustomerQueue } = require('../utils/mikrotikBandwidthManager');

const router = express.Router();

// Stripe requires raw body
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('❌ Stripe Webhook Error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;

      console.log('✅ Stripe Payment Success:', paymentIntent.id);

      const payment = await Payment.findOne({ transactionId: paymentIntent.id }).populate('customer plan');
      if (payment) {
        payment.status = 'Success';
        payment.expiryDate = new Date(Date.now() + payment.plan.duration * 24 * 60 * 60 * 1000);
        await payment.save();

        try {
          const customerDoc = payment.customer;
          const planDoc = payment.plan;
          if (customerDoc) {
            customerDoc.status = 'active';
            if (typeof customerDoc.save === 'function') {
              await customerDoc.save().catch(() => {});
            }
            if (customerDoc.connectionType === 'static') {
              await enableCustomerQueue(customerDoc, planDoc).catch(() => {});
            } else {
              await applyCustomerQueue(customerDoc, planDoc).catch(() => {});
            }
          }
        } catch (err) {
          console.warn('[stripe-webhook] queue sync failed:', err?.message || err);
        }

        console.log(`📶 Bandwidth applied for customer ${payment.customer.accountNumber}`);
      } else {
        console.warn('⚠️ No Payment record found for Stripe Intent:', paymentIntent.id);
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('⚠️ Stripe webhook processing failed:', err);
    res.status(500).send('Internal webhook error');
  }
});

module.exports = router;

