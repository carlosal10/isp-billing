// utils/stkPush.js
const axios = require('axios');

// --- simple masking helpers for logs ---
function maskMid(s, keep = 3) {
  if (!s) return null;
  const str = String(s);
  if (str.length <= keep * 2) return '*'.repeat(str.length);
  return str.slice(0, keep) + '***' + str.slice(-keep);
}
function maskPhone(msisdn) {
  if (!msisdn) return null;
  const s = String(msisdn);
  return s.replace(/^(\d{6})(\d+)(\d{2})$/, (_, a, mid, b) => a + '***' + b);
}

/** ---- helpers ---- */
function pad2(n) { return String(n).padStart(2, '0'); }

/** Daraja expects EAT timestamp: YYYYMMDDHHmmss */
function generateTimestampEAT(d = new Date()) {
  // Convert to Africa/Nairobi without extra deps
  // NOTE: This uses Intl which ships with Node’s ICU. If stripped ICU, fall back to +3.
  try {
    const parts = new Intl.DateTimeFormat('en-KE', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(d).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
    const yyyy = parts.year;
    const MM = parts.month;
    const dd = parts.day;
    const HH = parts.hour;
    const mm = parts.minute;
    const ss = parts.second;
    return `${yyyy}${MM}${dd}${HH}${mm}${ss}`;
  } catch {
    // Fallback: add +3h (rough, but better than wrong locale formatting)
    const eat = new Date(d.getTime() + 3 * 60 * 60 * 1000);
    return (
      eat.getUTCFullYear().toString() +
      pad2(eat.getUTCMonth() + 1) +
      pad2(eat.getUTCDate()) +
      pad2(eat.getUTCHours()) +
      pad2(eat.getUTCMinutes()) +
      pad2(eat.getUTCSeconds())
    );
  }
}

function generatePassword(shortcode, passkey, timestamp) {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

/** Normalize to 2547XXXXXXXX; reject anything else */
function normalizeMsisdn(input) {
  if (!input) return null;
  let s = String(input).replace(/\D/g, '');
  // Accept +2547XXXXXXXX, 2547XXXXXXXX, 07XXXXXXXX, 7XXXXXXXX
  if (/^0?7\d{8}$/.test(s)) s = `254${s.slice(-9)}`;
  if (s.startsWith('254') && s.length === 12 && /^2547\d{8}$/.test(s)) return s;
  return null;
}

/** Small safe string limits to avoid Daraja 400s */
function safeRef(x) {
  return String(x || 'PAY').replace(/[^A-Za-z0-9._\- ]/g, '').slice(0, 12);
}
function safeDesc(x) {
  return String(x || 'Payment').replace(/[^A-Za-z0-9._\- ]/g, '').slice(0, 20);
}

async function getAccessToken({ consumerKey, consumerSecret, environment = 'sandbox' }) {
  const host = environment === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const { data } = await axios.get(`${host}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
    timeout: 10000,
  });
  return data.access_token;
}

/**
 * sendSTKPush
 * @param {Object} opts
 * @param {string} opts.phone - MSISDN in any common KE format (07.., +2547.., 2547..)
 * @param {number} opts.amount - integer >= 1
 * @param {string} opts.shortcode - Paybill or Till (BusinessShortCode)
 * @param {string} opts.passkey  - Passkey matching the shortcode/till *and* environment
 * @param {string} opts.consumerKey
 * @param {string} opts.consumerSecret
 * @param {'sandbox'|'production'} [opts.environment='sandbox']
 * @param {'CustomerPayBillOnline'|'CustomerBuyGoodsOnline'} [opts.transactionType='CustomerPayBillOnline']
 * @param {string} [opts.transactionId] - your internal payment id
 * @param {string} [opts.callbackUrl] - must be HTTPS and reachable publicly (prod)
 * @param {string} [opts.accountReference] - <=12 chars recommended
 * @param {string} [opts.transactionDesc] - <=20 chars recommended
 */
async function sendSTKPush({
  phone,
  amount,
  shortcode,
  passkey,
  consumerKey,
  consumerSecret,
  environment = 'sandbox',
  transactionType = 'CustomerPayBillOnline',
  transactionId,
  callbackUrl = 'https://isp-billing-uq58.onrender.com/api/mpesa/callback',
  accountReference = 'Hotspot',
  transactionDesc = 'Hotspot Payment',
}) {
  // ---- validate inputs up front ----
  const msisdn = normalizeMsisdn(phone);
  if (!msisdn) {
    const err = new Error('Invalid phone. Use 2547XXXXXXXX format.');
    err.code = 'BAD_MSISDN';
    throw err;
  }
  const amt = Math.round(Number(amount));
  if (!(amt >= 1)) {
    const err = new Error('Invalid amount. Must be an integer >= 1.');
    err.code = 'BAD_AMOUNT';
    throw err;
  }
  if (!shortcode || !passkey || !consumerKey || !consumerSecret) {
    const err = new Error('Missing M-Pesa credentials (shortcode/passkey/consumerKey/consumerSecret).');
    err.code = 'MISSING_CREDS';
    throw err;
  }

  const host = environment === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

  const Timestamp = generateTimestampEAT(new Date());
  const Password = generatePassword(shortcode, passkey, Timestamp);
  const token = await getAccessToken({ consumerKey, consumerSecret, environment });
  const refSource = (accountReference && String(accountReference).trim()) || transactionId;
  const sanitizedRef = safeRef(refSource);

  const payload = {
    BusinessShortCode: shortcode,
    Password,
    Timestamp,
    TransactionType: transactionType,              // PayBill vs BuyGoods matters
    Amount: amt,
    PartyA: msisdn,
    PartyB: shortcode,
    PhoneNumber: msisdn,
    CallBackURL: callbackUrl,
    AccountReference: sanitizedRef,
    TransactionDesc: safeDesc(transactionDesc),
  };

  try {
    console.log('[stkPush] request', {
      env: environment,
      host,
      shortcode: maskMid(shortcode),
      phone: maskPhone(msisdn),
      amount: amt,
      callbackUrl,
      accountReference: payload.AccountReference,
      accountReferenceRaw: refSource || null,
      internalTransactionId: transactionId || null,
      transactionType,
      ts: Timestamp,
    });
    const { data } = await axios.post(
      `${host}/mpesa/stkpush/v1/processrequest`,
      payload,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
    );
    console.log('[stkPush] response', {
      MerchantRequestID: data?.MerchantRequestID,
      CheckoutRequestID: data?.CheckoutRequestID,
      ResponseCode: data?.ResponseCode,
      ResponseDescription: data?.ResponseDescription,
      CustomerMessage: data?.CustomerMessage,
    });
    return data;
  } catch (err) {
    // Bubble up Daraja's exact error so callers/logs see the cause
    const darajaBody = err.response?.data;
    const message = darajaBody?.errorMessage || err.message || 'STK push failed';
    const e = new Error(message);
    e.darajaStatus = err.response?.status || null;
    e.darajaResponse = darajaBody || null;
    console.error('[stkPush] error', {
      message: e.message,
      status: e.darajaStatus,
      daraja: e.darajaResponse,
    });
    throw e;
  }
}

module.exports = {
  sendSTKPush,
  getAccessToken,
  normalizeMsisdn: normalizeMsisdn, // exported for tests/logging
  generateTimestampEAT,
  generatePassword,
};
