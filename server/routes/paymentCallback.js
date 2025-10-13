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

function parseMpesaTimestamp(ts) {
  if (!ts) return null;
  const raw = String(ts).trim();
  if (!/^\d{14}$/.test(raw)) return null;
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6)) - 1;
  const day = Number(raw.slice(6, 8));
  const hour = Number(raw.slice(8, 10));
  const minute = Number(raw.slice(10, 12));
  const second = Number(raw.slice(12, 14));
  const date = new Date(Date.UTC(year, month, day, hour - 3, minute, second));
  return Number.isNaN(date.getTime()) ? null : date;
}

// -------------------- Safaricom STK Callback --------------------
async function handleStkCallback(req, res) {
  const body = req.body;
  console.log('M-Pesa Callback: body', JSON.stringify(body, null, 2));
  try {
    console.log('M-Pesa Callback: headers', {
      'x-forwarded-for': req.headers['x-forwarded-for'] || null,
      'user-agent': req.headers['user-agent'] || null,
      host: req.headers['host'] || null,
      contentType: req.headers['content-type'] || null,
    });
  } catch {}

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
    const transactionDate = callbackMetadata.find(i => i.Name === 'TransactionDate')?.Value;
    const checkoutRequestId = stkCallback.CheckoutRequestID;
    const merchantRequestId = stkCallback.MerchantRequestID;

    console.log('M-Pesa Callback: extracted', {
      resultCode,
      resultDesc,
      mpesaReceipt,
      amount,
      phone,
      checkoutRequestId,
      merchantRequestId,
      transactionDate,
    });

    // Find payment (primary: by stored CheckoutRequestID, fallback by MerchantRequestID)
    let payment = null;
    if (checkoutRequestId) {
      payment = await Payment.findOne({ checkoutRequestId }).populate('customer plan');
    }
    if (!payment && merchantRequestId) {
      payment = await Payment.findOne({ merchantRequestId }).populate('customer plan');
    }

    // Fallback: recent pending MPesa payment by phone+amount (last 2h)
    if (!payment && phone && amount) {
      const since = new Date(Date.now() - 2 * 60 * 60 * 1000);
      console.log('M-Pesa Callback: attempting fallback match by phone+amount', {
        phone,
        amount: Number(amount),
        since,
      });
      payment = await Payment.findOne({
        method: 'mpesa',
        status: 'Pending',
        phoneNumber: String(phone),
        amount: Number(amount),
        createdAt: { $gte: since },
      })
        .sort({ createdAt: -1 })
        .populate('customer plan');
      console.log('M-Pesa Callback: fallback match result', { found: !!payment, paymentId: payment?._id?.toString() || null });
    }

    if (!payment) {
      console.error('Payment not found for checkout/merchant id', {
        checkoutRequestId,
        merchantRequestId,
        resultCode,
        mpesaReceipt,
        amount,
        phone,
      });
    } else {
      // Always persist the gateway correlation ids if missing
      if (!payment.checkoutRequestId && checkoutRequestId) payment.checkoutRequestId = checkoutRequestId;
      if (!payment.merchantRequestId && merchantRequestId) payment.merchantRequestId = merchantRequestId;

      const paymentContext = {
        paymentId: String(payment._id),
        tenantId: payment.tenantId?.toString?.() || payment.tenantId || null,
        checkoutRequestId: checkoutRequestId || payment.checkoutRequestId || null,
        merchantRequestId: merchantRequestId || payment.merchantRequestId || null,
      };

      if (resultCode === 0) {
        // Success
        payment.status = 'Success';
        if (mpesaReceipt) payment.transactionId = mpesaReceipt;
        if (amount) payment.amount = Number(amount);
        if (phone) payment.phoneNumber = String(phone);
        const paidAt = parseMpesaTimestamp(transactionDate) || new Date();
        payment.validatedAt = paidAt;
        payment.validatedBy = 'mpesa-stk';

        // Compute expiry date from anchor: keep cycle date even if paid late
        if (payment.plan?.duration || Number.isFinite(payment.plan?.durationDays)) {
          const days = payment.plan?.durationDays ?? parseDurationToDays(payment.plan?.duration);
          if (Number.isFinite(days) && days > 0) {
            const anchor = payment.customer?.expiryDate ? new Date(payment.customer.expiryDate) : new Date();
            payment.expiryDate = new Date(anchor.getTime() + days * 24 * 60 * 60 * 1000);
          }
        }

        console.log('M-Pesa Callback: saving payment success', {
          ...paymentContext,
          mpesaReceipt,
          amount: Number(amount),
          phone: phone ? String(phone) : null,
          paidAt,
        });
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
              await enableCustomerQueue(customerDoc, planDoc);
              console.log('[payment-callback] queue re-enabled', {
                ...paymentContext,
                account: customerDoc.accountNumber || null,
                connectionType: customerDoc.connectionType || 'unknown',
                action: 'enable-static',
              });
            } else {
              await applyCustomerQueue(customerDoc, planDoc);
              console.log('[payment-callback] queue applied', {
                ...paymentContext,
                account: customerDoc.accountNumber || null,
                connectionType: customerDoc.connectionType || 'unknown',
                action: 'apply-non-static',
              });
            }
          }
        } catch (err) {
          console.warn('[payment-callback] queue sync failed:', {
            ...paymentContext,
            error: err?.message || err,
          });
        }

        console.log(`Payment ${payment._id} confirmed & bandwidth applied.`);
      } else {
        // Failed
        payment.status = 'Failed';
        payment.validatedAt = new Date();
        payment.validatedBy = 'mpesa-stk';
        console.log('M-Pesa Callback: saving payment failure', { paymentId: String(payment._id), resultDesc });
        await payment.save();
        console.warn(`Payment ${payment._id} failed: ${resultDesc}`);
      }
    }

    // Safaricom requires 0 response always
    res.json({ ResultCode: 0, ResultDesc: 'Success' });
  } catch (err) {
    const failCtx = {
      checkoutRequestId: req.body?.Body?.stkCallback?.CheckoutRequestID || null,
      merchantRequestId: req.body?.Body?.stkCallback?.MerchantRequestID || null,
    };
    console.error('Callback handling failed:', err?.message || err, failCtx);
    // Still acknowledge to Safaricom
    res.json({ ResultCode: 0, ResultDesc: 'Handled with error' });
  }
}

// Accept both .../callback and the mount root for flexibility
router.post('/callback', handleStkCallback);
router.post('/', handleStkCallback);

module.exports = router;
