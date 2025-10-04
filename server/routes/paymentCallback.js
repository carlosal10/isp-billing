// routes/paymentCallback.js
const express = require('express');
const router = express.Router();
const Payment = require('../models/Payment');
const { applyCustomerQueue, enableCustomerQueue } = require('../utils/mikrotikBandwidthManager');

function parseDurationToDays(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  const s = String(v).trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = s.match(/(\d+(\.\d+)?)\s*(day|week|month|year)s?/);
  if (m) {
    const n = parseFloat(m[1]); const u = m[3];
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

// -------------------- Safaricom STK Callback --------------------
async function handleStkCallback(req, res) {
  const body = req.body;
  console.log('M-Pesa Callback:', JSON.stringify(body, null, 2));

  try {
    // Safaricom sends response under Body.stkCallback
    const stkCallback = body?.Body?.stkCallback;
    if (!stkCallback) {
      return res.status(400).json({ error: 'Invalid callback format' });
    }

    const resultCode = stkCallback.ResultCode;
    const resultDesc = stkCallback.ResultDesc;
    const callbackMetadata = stkCallback.CallbackMetadata?.Item || [];

    // Extract values
    const mpesaReceipt = callbackMetadata.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
    const amount = callbackMetadata.find(i => i.Name === 'Amount')?.Value;
    const phone = callbackMetadata.find(i => i.Name === 'PhoneNumber')?.Value;
    const checkoutRequestId = stkCallback.CheckoutRequestID;
    const merchantRequestId = stkCallback.MerchantRequestID;

    // Find payment (primary: by stored CheckoutRequestID)
    let payment = await Payment.findOne({ checkoutRequestId }).populate('customer plan');

    // Fallback: recent pending MPesa payment by phone+amount (last 2h)
    if (!payment && phone && amount) {
      const since = new Date(Date.now() - 2 * 60 * 60 * 1000);
      payment = await Payment.findOne({
        method: 'mpesa',
        status: 'Pending',
        phoneNumber: String(phone),
        amount: Number(amount),
        createdAt: { $gte: since },
      })
        .sort({ createdAt: -1 })
        .populate('customer plan');
    }

    if (!payment) {
      console.error('Payment not found for checkout id:', checkoutRequestId);
    } else {
      // Always persist the gateway correlation ids if missing
      if (!payment.checkoutRequestId && checkoutRequestId) payment.checkoutRequestId = checkoutRequestId;
      if (!payment.merchantRequestId && merchantRequestId) payment.merchantRequestId = merchantRequestId;

      if (resultCode === 0) {
        // Success
        payment.status = 'Success';
        if (mpesaReceipt) payment.transactionId = mpesaReceipt;
        if (amount) payment.amount = Number(amount);
        if (phone) payment.phoneNumber = String(phone);

        // Compute expiry date from anchor: keep cycle date even if paid late
        if (payment.plan?.duration || Number.isFinite(payment.plan?.durationDays)) {
          const days = payment.plan?.durationDays ?? parseDurationToDays(payment.plan?.duration);
          if (Number.isFinite(days) && days > 0) {
            const anchor = payment.customer?.expiryDate ? new Date(payment.customer.expiryDate) : new Date();
            payment.expiryDate = new Date(anchor.getTime() + days * 24 * 60 * 60 * 1000);
          }
        }

        await payment.save();

        try {
          const customerDoc = payment.customer;
          const planDoc = payment.plan;
          if (customerDoc) {
            customerDoc.status = 'active';
            if (payment.expiryDate) customerDoc.expiryDate = payment.expiryDate;
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
          console.warn('[payment-callback] queue sync failed:', err?.message || err);
        }

        console.log(`Payment ${payment._id} confirmed & bandwidth applied.`);
      } else {
        // Failed
        payment.status = 'Failed';
        await payment.save();
        console.warn(`Payment ${payment._id} failed: ${resultDesc}`);
      }
    }

    // Safaricom requires 0 response always
    res.json({ ResultCode: 0, ResultDesc: 'Success' });
  } catch (err) {
    console.error('Callback handling failed:', err);
    // Still acknowledge to Safaricom
    res.json({ ResultCode: 0, ResultDesc: 'Handled with error' });
  }
}

// Accept both .../callback and the mount root for flexibility
router.post('/callback', handleStkCallback);
router.post('/', handleStkCallback);

module.exports = router;
