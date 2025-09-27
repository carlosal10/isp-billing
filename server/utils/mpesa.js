// utils/mpesa.js
const axios = require('axios');
const PaymentConfig = require('../models/PaymentConfig');

/* ---------- helpers ---------- */
function pickEnvHost(env) {
  const e = String(env || '').toLowerCase();
  return e === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
}

// EAT timestamp: YYYYMMDDHHmmss
function timestampEAT(d = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-KE', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(d).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
    return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
  } catch {
    // Fallback: +3h from UTC if ICU isn’t available
    const t = new Date(d.getTime() + 3 * 3600 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}`;
  }
}

function genPassword(shortcode, passkey, ts) {
  return Buffer.from(`${shortcode}${passkey}${ts}`).toString('base64');
}

function normalizeMsisdn(input) {
  if (!input) return null;
  let s = String(input).replace(/\D/g, '');
  // Accept 07XXXXXXXX, 7XXXXXXXX, +2547XXXXXXXX, 2547XXXXXXXX
  if (/^0?7\d{8}$/.test(s)) s = `254${s.slice(-9)}`;
  if (/^2547\d{8}$/.test(s)) return s;
  return null;
}

function safeRef(x)  { return String(x || 'PAY').replace(/[^A-Za-z0-9._\- ]/g, '').slice(0, 12); }
function safeDesc(x) { return String(x || 'Payment').replace(/[^A-Za-z0-9._\- ]/g, '').slice(0, 20); }

/* ---------- core ---------- */
async function getAccessToken({ consumerKey, consumerSecret, environment }) {
  if (!consumerKey || !consumerSecret) throw new Error('Missing M-Pesa consumer key/secret');
  const host = pickEnvHost(environment || process.env.MPESA_ENV);
  const url  = `${host}/oauth/v1/generate?grant_type=client_credentials`;
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const { data } = await axios.get(url, { headers: { Authorization: `Basic ${auth}` }, timeout: 10000 });
  return data.access_token;
}

/**
 * initiateSTKPush
 * @param {Object} opts
 * @param {string} opts.ispId           - tenant/ISP id
 * @param {number} opts.amount          - integer >= 1
 * @param {string} opts.phone           - 07.. | 7.. | 2547.. | +2547..
 * @param {string} opts.accountReference- <=12 chars
 * @param {string} opts.callbackURL     - https URL
 */
async function initiateSTKPush({ ispId, amount, phone, accountReference, callbackURL }) {
  // Load per-tenant config
  const cfg = await PaymentConfig.findOne({ ispId, provider: 'mpesa' }).lean();
  if (!cfg) throw new Error('M-Pesa configuration not found');

  const payMethod   = (cfg.payMethod || 'paybill').toLowerCase();   // 'paybill' | 'buygoods'
  const environment = cfg.environment || process.env.MPESA_ENV || 'sandbox';

  // Resolve credentials (prefer tenant; env as last resort)
  const consumerKey    = cfg.consumerKey    || process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = cfg.consumerSecret || process.env.MPESA_CONSUMER_SECRET;

  const shortcode = payMethod === 'buygoods'
    ? (cfg.buyGoodsTill     || process.env.MPESA_TILL            || process.env.MPESA_SHORTCODE)
    : (cfg.paybillShortcode || process.env.MPESA_SHORTCODE);

  const passkey = payMethod === 'buygoods'
    ? (cfg.buyGoodsPasskey  || process.env.MPESA_TILL_PASSKEY    || process.env.MPESA_PASSKEY)
    : (cfg.paybillPasskey   || process.env.MPESA_PASSKEY);

  if (!consumerKey || !consumerSecret) throw new Error('Missing consumerKey/consumerSecret');
  if (!shortcode || !passkey)          throw new Error('Missing shortcode/passkey configuration');

  const msisdn = normalizeMsisdn(phone);
  if (!msisdn) throw new Error('Invalid phone. Use 2547XXXXXXXX');

  const amt = Math.round(Number(amount));
  if (!(amt >= 1)) throw new Error('Invalid amount. Must be >= 1');

  if (!/^https:\/\//i.test(String(callbackURL || ''))) {
    throw new Error('Callback URL must be HTTPS');
  }

  const host   = pickEnvHost(environment);
  const ts     = timestampEAT();
  const pwd    = genPassword(String(shortcode), String(passkey), ts);
  const token  = await getAccessToken({ consumerKey, consumerSecret, environment });

  const payload = {
    BusinessShortCode: String(shortcode),
    Password: pwd,
    Timestamp: ts,
    TransactionType: payMethod === 'buygoods' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
    Amount: amt,
    PartyA: msisdn,
    PartyB: String(shortcode),
    PhoneNumber: msisdn,
    CallBackURL: String(callbackURL),
    AccountReference: safeRef(accountReference),
    TransactionDesc: safeDesc(payMethod === 'buygoods' ? 'Till Payment' : 'Paybill Payment'),
  };

  try {
    const { data } = await axios.post(`${host}/mpesa/stkpush/v1/processrequest`, payload, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    return data;
  } catch (err) {
    // Bubble up Daraja’s error body so callers/logs see the exact cause
    const daraja = err.response?.data;
    const message = daraja?.errorMessage || err.message || 'STK push failed';
    const e = new Error(message);
    e.darajaStatus = err.response?.status || null;
    e.darajaResponse = daraja || null;
    throw e;
  }
}

module.exports = { initiateSTKPush, getAccessToken, pickEnvHost };
