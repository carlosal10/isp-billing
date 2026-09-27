const express = require('express');
const router = express.Router();
const { getPayInfo, verifyPayToken } = require('../utils/paylink');
const Payment = require('../models/Payment');
const { sendSTKPush } = require('../utils/stkPush');
const PaymentConfig = require('../models/PaymentConfig');
const { upsertStkCorrelation } = require('../services/paymentGatewayCorrelationService');
const { ensureCollectableInvoiceForPaymentStart } = require('../services/billingFinanceService');
const { paymentInitiationLimiter } = require('../middleware/riskRateLimits');
const { decryptPaymentConfig } = require('../security/fieldEncryption');

function normalizePhone(msisdn) {
  let s = String(msisdn).replace(/\D/g, '');
  // Accept 07XXXXXXXX, 7XXXXXXXX, or 2547XXXXXXXX -> normalize to 2547XXXXXXXX
  if (/^0?7\d{8}$/.test(s)) s = `254${s.slice(-9)}`;
  if (!/^2547\d{8}$/.test(s)) return null;
  return s;
}

function shortRef(x) {
  return (x || 'PAY').toString().replace(/[^A-Za-z0-9\-_. ]/g, '').slice(0, 12);
}

function buildPaylinkStatusFilter({ paymentId, token } = {}) {
  const id = String(paymentId || '').trim();
  if (!id) {
    const error = new Error('Missing paymentId');
    error.statusCode = 400;
    throw error;
  }
  if (!token) {
    const error = new Error('Paylink token is required');
    error.statusCode = 400;
    throw error;
  }

  let decoded;
  try {
    decoded = verifyPayToken(token);
  } catch (error) {
    error.statusCode = 401;
    throw error;
  }
  const tenantId = String(decoded?.tenantId || '').trim();
  const customerId = String(decoded?.customerId || '').trim();
  if (!tenantId || !customerId) {
    const error = new Error('Invalid paylink token');
    error.statusCode = 401;
    throw error;
  }

  return {
    _id: id,
    tenantId,
    customer: customerId,
  };
}

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

router.post('/stk', paymentInitiationLimiter, async (req, res) => {
  try {
    const { token, phone } = req.body || {};
    if (!token || !phone) return res.status(400).json({ error: 'Missing token or phone' });

    const decoded = verifyPayToken(token);
    const { tenantId, customerId, planId } = decoded;

    console.log('[paylink:/stk] request', {
      requestId: req.id || null,
    });

    // 1) Load tenant config (fallback to env for legacy)
    const storedConfig = await PaymentConfig.findOne({ ispId: String(tenantId), provider: 'mpesa' }).lean();
    const cfg = decryptPaymentConfig(storedConfig);

    const payMethod = cfg?.payMethod === 'buygoods' ? 'buygoods' : 'paybill';
    const environment = cfg?.environment === 'production' ? 'production' : 'sandbox';

    const shortcode = payMethod === 'buygoods'
      ? (cfg?.buyGoodsTill || process.env.MPESA_TILL)         // optional fallback
      : (cfg?.paybillShortcode || process.env.MPESA_SHORTCODE);

    const passkey = payMethod === 'buygoods'
      ? (cfg?.buyGoodsPasskey || process.env.MPESA_TILL_PASSKEY)
      : (cfg?.paybillPasskey || process.env.MPESA_PASSKEY);

    const consumerKey = cfg?.consumerKey || process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = cfg?.consumerSecret || process.env.MPESA_CONSUMER_SECRET;

    if (!shortcode || !passkey || !consumerKey || !consumerSecret) {
      return res.status(400).json({ error: 'M-Pesa credentials not configured' });
    }

    // 2) Server-side price (prevents client tampering)
    const info = await getPayInfo({ token });
    const amount = Number(info?.plan?.price);
    if (!Number.isFinite(amount) || amount < 1) {
      return res.status(400).json({ error: 'Invalid plan amount' });
    }
    const invoice = await ensureCollectableInvoiceForPaymentStart({
      tenantId,
      customerId,
      planId,
      issueDate: new Date(),
    }).catch(() => null);

    // 3) Normalize + validate MSISDN
    const msisdn = normalizePhone(phone);
    if (!msisdn) return res.status(400).json({ error: 'Invalid phone. Use 2547XXXXXXXX' });

    // 4) Create pending payment
    const payment = await Payment.create({
      tenantId,
      accountNumber: info.customer?.accountNumber || 'N/A',
      phoneNumber: msisdn,
      customer: customerId,
      invoice: invoice?._id || null,
      plan: planId,
      amount,
      method: 'mpesa',
      status: 'Pending',
    });

    console.log('[paylink:/stk] created payment', {
      requestId: req.id || null,
      amount,
    });

    // 5) Compute callback base
    const apiBase = process.env.VITE_API_URL || '';
    const serverBase = apiBase.replace(/\/?api\/?$/, '');
    const callbackUrl = process.env.MPESA_CALLBACK_URL || `${serverBase}/api/payment/callback/callback`;

    // 6) Pick TransactionType per payMethod
    const transactionType = payMethod === 'buygoods'
      ? 'CustomerBuyGoodsOnline'
      : 'CustomerPayBillOnline';

    // 7) Fire STK
    const resp = await sendSTKPush({
      phone: msisdn,
      amount,
      shortcode,
      passkey,
      consumerKey,
      consumerSecret,
      environment,       // NEW
      transactionType,   // NEW
      transactionId: String(payment._id),
      callbackUrl,
      accountReference: shortRef(info.customer?.accountNumber || 'Hotspot'),
      transactionDesc: 'Subscription Payment',
    });

    console.log('[paylink:/stk] STK response', {
      requestId: req.id || null,
      ResponseCode: resp?.ResponseCode,
    });

    // Persist Daraja correlation ids so callback can match this payment
    try {
      const checkoutRequestId = resp?.CheckoutRequestID;
      const merchantRequestId = resp?.MerchantRequestID;
      if (checkoutRequestId || merchantRequestId) {
        await Payment.updateOne(
          { _id: payment._id },
          { $set: { checkoutRequestId: checkoutRequestId || undefined, merchantRequestId: merchantRequestId || undefined } }
        );
        await upsertStkCorrelation({
          tenantId,
          paymentId: payment._id,
          customerId,
          planId,
          accountNumber: info.customer?.accountNumber || null,
          phoneNumber: msisdn,
          amount,
          checkoutRequestId,
          merchantRequestId,
          source: 'paylink:/stk',
          callbackUrl,
        }).catch((correlationError) => {
          console.warn('Could not persist STK correlation:', correlationError?.message || correlationError);
        });
        console.log('[paylink:/stk] saved STK ids to payment', {
          requestId: req.id || null,
          hasCheckoutRequestId: Boolean(checkoutRequestId),
          hasMerchantRequestId: Boolean(merchantRequestId),
        });
      }
    } catch (e) {
      console.warn('Could not persist STK ids to payment:', e?.message || e);
    }

    res.json({ ok: true, paymentId: payment._id, stk: resp });
  } catch (e) {
    // Surface Daraja error body if available
    const darajaStatus = e.response?.status;
    const darajaResponse = e.response?.data;
    console.error('paylink stk error', {
      message: e.message,
      darajaStatus,
      darajaResponse,
    });
    res.status(500).json({
      error: e.message || 'Failed to trigger STK push',
      darajaStatus: darajaStatus || null,
      darajaResponse: darajaResponse || null,
    });
  }
});

// Poll payment status (public)
router.get('/status', async (req, res) => {
  try {
    const { paymentId, token } = req.query || {};
    const filter = buildPaylinkStatusFilter({ paymentId, token });
    const p = await Payment.findOne(filter).lean();
    if (!p) return res.status(404).json({ error: 'Payment not found' });
    res.json({
      status: p.status,
      amount: p.amount,
      method: p.method,
    });
  } catch (e) {
    const status = Number(e?.statusCode) || (e?.name === 'JsonWebTokenError' || e?.name === 'TokenExpiredError' ? 401 : 500);
    res.status(status).json({ error: e.message || 'Failed to fetch payment status' });
  }
});

module.exports = router;
module.exports.buildPaylinkStatusFilter = buildPaylinkStatusFilter;
