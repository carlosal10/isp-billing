//utils/mpesa.js
const axios = require('axios');
const PaymentConfig = require('../models/PaymentConfig');

function pickEnvHost(env) {
  const e = String(env || '').toLowerCase();
  return e === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
}

async function getAccessToken({ consumerKey, consumerSecret, environment }) {
  if (!consumerKey || !consumerSecret) throw new Error('Missing M-Pesa consumer key/secret');
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const host = pickEnvHost(environment || process.env.MPESA_ENV);
  const url = `${host}/oauth/v1/generate?grant_type=client_credentials`;
  const response = await axios.get(url, { headers: { Authorization: `Basic ${auth}` } });
  return response.data.access_token;
}

async function initiateSTKPush({ ispId, amount, phone, accountReference, callbackURL }) {
  // Load per-tenant config
  const cfg = await PaymentConfig.findOne({ ispId, provider: 'mpesa' }).lean();
  if (!cfg) throw new Error('M-Pesa configuration not found');

  // Resolve credentials with safe fallbacks (env only as last resort)
  const consumerKey = cfg.consumerKey || process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = cfg.consumerSecret || process.env.MPESA_CONSUMER_SECRET;
  const payMethod = (cfg.payMethod || 'paybill').toLowerCase(); // 'paybill' | 'buygoods'
  const environment = cfg.environment || process.env.MPESA_ENV || 'sandbox';

  // Resolve shortcode/passkey depending on method
  const shortCode =
    payMethod === 'buygoods'
      ? (cfg.buyGoodsTill || process.env.MPESA_SHORTCODE)
      : (cfg.paybillShortcode || process.env.MPESA_SHORTCODE);
  const passkey =
    payMethod === 'buygoods'
      ? (cfg.buyGoodsPasskey || process.env.MPESA_PASSKEY)
      : (cfg.paybillPasskey || process.env.MPESA_PASSKEY);

  if (!shortCode || !passkey) throw new Error('Missing shortcode/passkey configuration');

  const token = await getAccessToken({ consumerKey, consumerSecret, environment });

  // LNMO password
  const timestamp = new Date().toISOString().replace(/[-T:Z.]/g, '').slice(0, 14);
  const password = Buffer.from(String(shortCode) + String(passkey) + String(timestamp)).toString('base64');

  const host = pickEnvHost(environment);
  const url = `${host}/mpesa/stkpush/v1/processrequest`;

  const payload = {
    BusinessShortCode: String(shortCode),
    Password: password,
    Timestamp: timestamp,
    TransactionType: payMethod === 'buygoods' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
    Amount: Number(amount),
    PartyA: String(phone),
    PartyB: String(shortCode),
    PhoneNumber: String(phone),
    CallBackURL: callbackURL,
    AccountReference: String(accountReference),
    TransactionDesc: 'Hotspot Purchase',
  };

  const response = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });

  return response.data;
}

module.exports = { initiateSTKPush };
