const axios = require('axios');
const qs = require('querystring');
const SmsSettings = require('../models/SmsSettings');

function getEnv(name, def = undefined) {
  return process.env[name] || def;
}

function pickTenantFallback(provider, tenantSettings) {
  // Return credentials, preferring tenant settings; fall back to env
  if (provider === 'twilio') {
    const acc = tenantSettings?.twilio?.accountSid || getEnv('TWILIO_ACCOUNT_SID');
    const tok = tenantSettings?.twilio?.authToken || getEnv('TWILIO_AUTH_TOKEN');
    const from = tenantSettings?.twilio?.from || tenantSettings?.senderId || getEnv('TWILIO_FROM');
    if (acc && tok && from) return { accountSid: acc, authToken: tok, from };
    return null;
  }
  if (provider === 'africastalking') {
    // Accept both AFRICASTALKING_* and AFRICA_TALKING_* env names
    const apiKey = tenantSettings?.africastalking?.apiKey || getEnv('AFRICASTALKING_API_KEY') || getEnv('AFRICA_TALKING_API_KEY');
    const username = tenantSettings?.africastalking?.username || getEnv('AFRICASTALKING_USERNAME') || getEnv('AFRICA_TALKING_USERNAME');
    const from = tenantSettings?.africastalking?.from || tenantSettings?.senderId || getEnv('AFRICASTALKING_FROM') || getEnv('AFRICA_TALKING_FROM');
    const sandboxEnv = (tenantSettings?.africastalking?.useSandbox === true)
      || String(getEnv('AFRICASTALKING_ENV') || getEnv('AFRICA_TALKING_ENV') || '').toLowerCase() === 'sandbox'
      || String(username || '').toLowerCase() === 'sandbox';
    if (apiKey && username) return { apiKey, username, from, sandbox: !!sandboxEnv };
    return null;
  }
  return null;
}

async function sendViaTwilio(creds, to, body) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.accountSid)}/Messages.json`;
  const data = qs.stringify({ From: creds.from, To: to, Body: body });
  const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64');
  const res = await axios.post(url, data, {
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeout: 15000,
  });
  return { id: res.data?.sid, provider: 'twilio', raw: res.data };
}

async function sendViaAfricasTalking(creds, to, body) {
  const base = creds.sandbox ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';
  const url = `${base}/version1/messaging`;
  const data = qs.stringify({ username: creds.username, to, message: body, from: creds.from });
  const res = await axios.post(url, data, {
    headers: {
      apiKey: creds.apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    timeout: 15000,
  });
  const msg = res.data?.SMSMessageData?.Recipients?.[0] || {};
  return { id: msg?.messageId || String(Date.now()), provider: 'africastalking', raw: res.data };
}

function normalizePhone(phone) {
  if (!phone) return phone;
  const p = String(phone).trim();
  if (p.startsWith('+')) return p;
  if (p.startsWith('0')) return '+254' + p.slice(1); // Kenya default
  if (/^\d{12}$/.test(p) && p.startsWith('254')) return '+'.concat(p);
  return p;
}

async function sendSms(tenantId, to, body) {
  const settings = await SmsSettings.findOne({ tenantId }).lean();
  const enabled = settings?.enabled ?? false;
  if (!enabled) throw new Error('SMS disabled');

  const primary = settings?.primaryProvider || 'twilio';
  const normalized = normalizePhone(to);

  // Use fallback only if explicitly enabled
  const order = settings?.fallbackEnabled
    ? [primary, primary === 'twilio' ? 'africastalking' : 'twilio']
    : [primary];

  let lastError = null;
  let firstError = null;
  for (const p of order) {
    try {
      const creds = pickTenantFallback(p, settings);
      if (!creds) throw new Error(`Missing credentials for ${p}`);
      if (p === 'twilio') return await sendViaTwilio(creds, normalized, body);
      if (p === 'africastalking') return await sendViaAfricasTalking(creds, normalized, body);
      throw new Error('Unsupported SMS provider');
    } catch (e) {
      if (!firstError) firstError = e;
      lastError = e;
    }
  }
  throw firstError || lastError || new Error('No SMS provider configured');
}

module.exports = { sendSms, normalizePhone };
