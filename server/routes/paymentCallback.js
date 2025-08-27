// routes/paymentCallback.js
const express = require('express');
const router = express.Router();
const Payment = require('../models/Payment');
const { applyCustomerQueue } = require('../utils/mikrotikBandwidthManager');

// -------------------- Safaricom STK Callback --------------------
router.post('/callback', async (req, res) => {
  const body = req.body;
  console.log('📩 M-Pesa Callback:', JSON.stringify(body, null, 2));

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
    const accountReference = stkCallback.CheckoutRequestID; // we stored payment._id as reference

    // Find payment
    const payment = await Payment.findById(accountReference).populate('customer plan');
    if (!payment) {
      console.error('❌ Payment not found for reference:', accountReference);
    } else {
      if (resultCode === 0) {
        // ✅ Success
        payment.status = 'Success';
        payment.transactionId = mpesaReceipt;
        payment.amount = amount || payment.amount;
        payment.phoneNumber = phone || payment.phoneNumber;

        // Set expiry date from plan duration (in days)
        if (payment.plan?.duration) {
          payment.expiryDate = new Date(Date.now() + payment.plan.duration * 24 * 60 * 60 * 1000);
        }

        await payment.save();

        // Apply bandwidth in MikroTik
        await applyCustomerQueue(payment.customer, payment.plan);

        console.log(`✅ Payment ${payment._id} confirmed & bandwidth applied.`);
      } else {
        // ❌ Failed
        payment.status = 'Failed';
        await payment.save();
        console.warn(`⚠️ Payment ${payment._id} failed: ${resultDesc}`);
      }
    }

    // Safaricom requires 0 response always
    res.json({ ResultCode: 0, ResultDesc: 'Success' });

  } catch (err) {
    console.error('🔥 Callback handling failed:', err);
    // Still acknowledge to Safaricom
    res.json({ ResultCode: 0, ResultDesc: 'Handled with error' });
  }
});

module.exports = router;
