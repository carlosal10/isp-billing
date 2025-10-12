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
  if (provider === 'textsms') {
    const apiKey = tenantSettings?.textsms?.apiKey || getEnv('TEXTSMS_API_KEY');
    const partnerId = tenantSettings?.textsms?.partnerId || getEnv('TEXTSMS_PARTNER_ID');
    const baseUrl = tenantSettings?.textsms?.baseUrl || getEnv('TEXTSMS_BASE_URL');
    const sender = tenantSettings?.textsms?.sender || tenantSettings?.senderId || getEnv('TEXTSMS_SENDER');
    if (apiKey && partnerId && baseUrl) return { apiKey, partnerId, baseUrl, sender };
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
  const payload = { username: creds.username, to, message: body, bulkSMSMode: 1, enqueue: 1 };
  if (creds.from) payload.from = creds.from;
  const res = await axios.post(url, qs.stringify(payload), {
    headers: {
      apiKey: creds.apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    timeout: 15000,
  });
  const msgData = res.data?.SMSMessageData;
  const rec = Array.isArray(msgData?.Recipients) ? msgData.Recipients[0] : null;
  const status = String(rec?.status || '').toLowerCase();
  if (!rec) throw new Error('Africa\'s Talking: No recipients in response');
  if (status !== 'success') {
    const msg = `Africa's Talking: ${rec?.status || 'Failed'} (${rec?.statusCode || ''}) ${rec?.errorMessage || ''}`.trim();
    throw new Error(msg);
  }
  return { id: rec?.messageId || String(Date.now()), provider: 'africastalking', status: rec?.status, cost: rec?.cost, raw: res.data };
}

async function sendViaTextSms(creds, to, body) {
  if (!creds.baseUrl) throw new Error('TextSms: Missing API URL');
  const recipient = Array.isArray(to) ? to.join(',') : to;
  const payload = {
    partnerID: creds.partnerId,
    apikey: creds.apiKey,
    mobile: recipient,
    message: body,
  };
  if (creds.sender) payload.shortcode = creds.sender;

  let res;
  try {
    res = await axios.post(
      creds.baseUrl,
      qs.stringify(payload),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      },
    );
  } catch (err) {
    const data = err?.response?.data;
    if (data && typeof data === 'object') {
      const friendly = describeTextSmsError(data);
      if (friendly) throw new Error(friendly);
    }
    throw err;
  }

  const data = res.data;
  if (data && typeof data === 'object') {
    const statusValue = data.status || data.Status || data.code || data.Code;
    const ok = typeof statusValue === 'string'
      ? /success|accept|queued|ok|sent/i.test(statusValue)
      : statusValue === 200 || statusValue === 1701 || statusValue === 0 || statusValue === true;
    if (!ok && data.error) {
      throw new Error(`TextSms: ${data.error}`);
    }
    if (!ok && data.errors) {
      const first = Array.isArray(data.errors) ? data.errors[0] : data.errors;
      const friendly = describeTextSmsError({ errors: first });
      if (friendly) throw new Error(friendly);
      throw new Error(`TextSms: ${String(first)}`);
    }
    if (!ok && data.description) {
      throw new Error(`TextSms: ${data.description}`);
    }
    const id = data.message_id || data.MessageID || data.id || String(Date.now());
    return { id, provider: 'textsms', raw: data, status: statusValue || 'accepted' };
  }

  const text = typeof data === 'string' ? data.trim() : '';
  if (text) {
    if (/error|invalid|failed/i.test(text) && !/1701|success|ok|queued|accepted/i.test(text)) {
      throw new Error(`TextSms: ${text}`);
    }
    const parts = text.split('|');
    const id = parts.length > 1 ? parts[1] : text.replace(/[^A-Za-z0-9_-]/g, '');
    return { id: id || String(Date.now()), provider: 'textsms', raw: text, status: 'accepted' };
  }

  return { id: String(Date.now()), provider: 'textsms', raw: data, status: 'accepted' };
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

  const providers = ['twilio', 'africastalking', 'textsms'];
  const orderRaw = settings?.fallbackEnabled
    ? [primary, ...providers.filter((p) => p !== primary)]
    : [primary];
  const order = Array.from(new Set(orderRaw));

  let lastError = null;
  let firstError = null;
  for (const p of order) {
    try {
      const creds = pickTenantFallback(p, settings);
      if (!creds) throw new Error(`Missing credentials for ${p}`);
      if (p === 'twilio') return await sendViaTwilio(creds, normalized, body);
      if (p === 'africastalking') return await sendViaAfricasTalking(creds, normalized, body);
      if (p === 'textsms') return await sendViaTextSms(creds, normalized, body);
      throw new Error('Unsupported SMS provider');
    } catch (e) {
      if (!firstError) firstError = e;
      lastError = e;
    }
  }
  throw firstError || lastError || new Error('No SMS provider configured');
}

function describeTextSmsError(data) {
  if (!data || typeof data !== 'object') return null;
  const desc = data['response-description'] || data.description || data.message || null;

  function findFirstMessage(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const inner = findFirstMessage(entry);
        if (inner) return inner;
      }
    } else if (typeof value === 'object') {
      for (const val of Object.values(value)) {
        const inner = findFirstMessage(val);
        if (inner) return inner;
      }
    }
    return null;
  }

  const specific = findFirstMessage(data.errors);
  const combined = [desc, specific].filter(Boolean).join(': ');
  return combined ? `TextSms: ${combined}` : null;
}

module.exports = { sendSms, normalizePhone };
