const express = require('express');
const router = express.Router();
const { getPayInfo, verifyPayToken } = require('../utils/paylink');
const Payment = require('../models/Payment');
const { sendSTKPush } = require('../utils/stkPush');
const PaymentConfig = require('../models/PaymentConfig');

// Public: return plan + options for given token
router.get('/info', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Missing token' });
    const info = await getPayInfo({ token });
    res.json(info);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Invalid or expired token' });
  }
});

// Public: trigger STK push with token + phone
router.post('/stk', async (req, res) => {
  try {
    const { token, phone } = req.body || {};
    if (!token || !phone) return res.status(400).json({ error: 'Missing token or phone' });
    const decoded = verifyPayToken(token);
    const { tenantId, customerId, planId } = decoded;

    // Load PaymentConfig for tenant (if exists) else env
    const cfg = await PaymentConfig.findOne({ ispId: String(tenantId), provider: 'mpesa' }).lean();
    const shortcode = cfg?.paybillShortcode || process.env.MPESA_SHORTCODE;
    const passkey = cfg?.paybillPasskey || process.env.MPESA_PASSKEY;
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    if (!shortcode || !passkey || !consumerKey || !consumerSecret) {
      return res.status(400).json({ error: 'M-Pesa credentials not configured' });
    }

    // Amount from info endpoint (server-side)
    const info = await getPayInfo({ token });
    const amount = info?.plan?.price;
    if (!amount) return res.status(400).json({ error: 'Invalid plan amount' });

    // Create a Payment record (Pending)
    const payment = await Payment.create({
      tenantId,
      accountNumber: info.customer?.accountNumber || 'N/A',
      phoneNumber: phone,
      customer: customerId,
      plan: planId,
      amount,
      method: 'mpesa',
      status: 'Pending',
    });

    const apiBase = process.env.VITE_API_URL || '';
    const serverBase = apiBase.replace(/\/?api\/?$/, '');
    const callbackUrl = process.env.MPESA_CALLBACK_URL || `${serverBase}/api/payment/callback/callback`;
    const resp = await sendSTKPush({
      phone,
      amount,
      shortcode,
      passkey,
      consumerKey,
      consumerSecret,
      transactionId: String(payment._id),
      callbackUrl,
      accountReference: info.customer?.accountNumber || 'Hotspot',
      transactionDesc: 'Subscription Payment',
    });

    res.json({ ok: true, paymentId: payment._id, stk: resp });
  } catch (e) {
    console.error('paylink stk error', e);
    res.status(500).json({ error: e.message || 'Failed to trigger STK push' });
  }
});

module.exports = router;
