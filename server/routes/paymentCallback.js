// routes/paymentCallback.js
const express = require('express');
const router = express.Router();
const {
  hashValue,
  buildHeaderSnapshot,
  recordGatewayEvent,
  beginGatewayEventProcessing,
  finalizeGatewayEvent,
  shouldSkipDuplicate,
} = require('../services/paymentGatewayEventService');
const { processGatewayEvent } = require('../services/paymentGatewayProcessingService');

// -------------------- Safaricom STK Callback --------------------
async function handleStkCallback(req, res) {
  const body = req.body;
  const headers = buildHeaderSnapshot(req.headers);
  let gatewayEvent = null;
  let gatewayEventMeta = null;
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
      const invalidDedupeKey = `mpesa:stk:invalid:${hashValue(body || {})}`;
      const recorded = await recordGatewayEvent({
        provider: 'mpesa',
        kind: 'stk-callback',
        dedupeKey: invalidDedupeKey,
        eventStatus: 'rejected',
        sourcePath: req.originalUrl,
        headers,
        payload: body,
        processingError: 'Invalid callback format',
      });
      await finalizeGatewayEvent(recorded.event._id, {
        eventStatus: 'rejected',
        sourcePath: req.originalUrl,
        headers,
        payload: body,
        processingError: 'Invalid callback format',
      }).catch(() => {});
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
    const dedupeKey = `mpesa:stk:${checkoutRequestId || merchantRequestId || mpesaReceipt || hashValue(body || {})}`;

    gatewayEventMeta = {
      provider: 'mpesa',
      kind: 'stk-callback',
      dedupeKey,
      sourcePath: req.originalUrl,
      externalId: checkoutRequestId || merchantRequestId || mpesaReceipt || null,
      externalRef: merchantRequestId || checkoutRequestId || null,
      transactionId: mpesaReceipt || null,
      phoneNumber: phone ? String(phone) : null,
      amount: Number(amount),
      resultCode,
      resultDesc,
      payload: body,
      headers,
    };
    const recorded = await recordGatewayEvent(gatewayEventMeta);
    gatewayEvent = recorded.event;
    if (recorded.isDuplicate && shouldSkipDuplicate(gatewayEvent)) {
      return res.json({ ResultCode: 0, ResultDesc: 'Success' });
    }
    gatewayEvent = await beginGatewayEventProcessing(gatewayEvent._id);

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

    await processGatewayEvent(gatewayEvent);

    // Safaricom requires 0 response always
    res.json({ ResultCode: 0, ResultDesc: 'Success' });
  } catch (err) {
    const failCtx = {
      checkoutRequestId: req.body?.Body?.stkCallback?.CheckoutRequestID || null,
      merchantRequestId: req.body?.Body?.stkCallback?.MerchantRequestID || null,
    };
    console.error('Callback handling failed:', err?.message || err, failCtx);
    if (gatewayEvent?._id) {
      await finalizeGatewayEvent(gatewayEvent._id, {
        ...(gatewayEventMeta || {}),
        eventStatus: 'failed',
        processingError: err?.message || String(err),
        payload: body,
        headers,
      }).catch(() => {});
    }
    // Still acknowledge to Safaricom
    res.json({ ResultCode: 0, ResultDesc: 'Handled with error' });
  }
}

// Accept both .../callback and the mount root for flexibility
router.post('/callback', handleStkCallback);
router.post('/', handleStkCallback);

module.exports = router;
