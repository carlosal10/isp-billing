//utils/mpesa.js
const axios = require('axios');
const MpesaConfig = require('../models/PaymentConfig');

async function getAccessToken(config) {
  const { consumerKey, consumerSecret } = config;
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

  const response = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
    headers: { Authorization: `Basic ${auth}` }
  });

  return response.data.access_token;
}

async function initiateSTKPush({ ispId, amount, phone, accountReference, callbackURL }) {
  const config = await MpesaConfig.findOne({ ispId });
  if (!config) throw new Error('M-Pesa configuration not found');

  const token = await getAccessToken(config);

  const timestamp = new Date().toISOString().replace(/[-T:Z.]/g, '').slice(0, 14);
  const password = Buffer.from(config.shortCode + config.passkey + timestamp).toString('base64');

  const payload = {
    BusinessShortCode: config.shortCode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: config.payMethod === 'paybill' ? 'CustomerPayBillOnline' : 'CustomerBuyGoodsOnline',
    Amount: amount,
    PartyA: phone,
    PartyB: config.shortCode,
    PhoneNumber: phone,
    CallBackURL: callbackURL,
    AccountReference: accountReference,
    TransactionDesc: 'Hotspot Purchase'
  };

  const response = await axios.post(
    'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return response.data;
}

module.exports = { initiateSTKPush };
