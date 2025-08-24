const axios = require('axios');
const moment = require('moment');

async function getAccessToken({ consumerKey, consumerSecret }) {
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

  const res = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });

  return res.data.access_token;
}

function generateTimestamp() {
  return moment().format('YYYYMMDDHHmmss');
}

function generatePassword(shortcode, passkey, timestamp) {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

async function sendSTKPush({
  phone,
  amount,
  shortcode,
  passkey,
  consumerKey,
  consumerSecret,
  transactionId,
  callbackUrl = 'https://yourdomain.com/api/mpesa/callback',
  accountReference = 'Hotspot',
  transactionDesc = 'Hotspot Payment',
}) {
  try {
    const timestamp = generateTimestamp();
    const password = generatePassword(shortcode, passkey, timestamp);

    const accessToken = await getAccessToken({ consumerKey, consumerSecret });

    const payload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: formatPhone(phone),
      PartyB: shortcode,
      PhoneNumber: formatPhone(phone),
      CallBackURL: callbackUrl,
      AccountReference: transactionId || accountReference,
      TransactionDesc: transactionDesc,
    };

    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  } catch (err) {
    console.error('STK Push error:', err.response?.data || err.message);
    throw new Error('Failed to send STK Push');
  }
}

function formatPhone(phone) {
  return phone.replace(/^0/, '254'); // e.g., 0712... → 254712...
}

module.exports = {
  sendSTKPush,
  getAccessToken,
  formatPhone,
};
