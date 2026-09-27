'use strict';

const { PAYMENT_SECRET_FIELDS } = require('../security/fieldEncryption');

const PAYMENT_PROVIDER_FIELDS = Object.freeze({
  mpesa: [
    'businessName',
    'buyGoodsPasskey',
    'buyGoodsTill',
    'consumerKey',
    'consumerSecret',
    'environment',
    'payMethod',
    'paybillPasskey',
    'paybillShortcode',
  ],
  paypal: ['clientId', 'clientSecret'],
  stripe: ['publishableKey', 'secretKey'],
});

const PAYMENT_SAFE_FIELDS = Object.freeze({
  mpesa: ['businessName', 'buyGoodsTill', 'environment', 'payMethod', 'paybillShortcode'],
  paypal: [],
  stripe: ['publishableKey'],
});

function plainObject(value) {
  if (!value) return {};
  return typeof value.toObject === 'function' ? value.toObject() : value;
}

function normalizePaymentProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  return Object.hasOwn(PAYMENT_PROVIDER_FIELDS, provider) ? provider : null;
}

function sanitizePaymentConfigInput(providerValue, input = {}) {
  const provider = normalizePaymentProvider(providerValue);
  if (!provider) {
    const error = new Error('Unsupported payment provider');
    error.statusCode = 400;
    throw error;
  }

  const secretFields = new Set(PAYMENT_SECRET_FIELDS[provider]);
  const output = {};
  for (const field of PAYMENT_PROVIDER_FIELDS[provider]) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) continue;
    const value = input[field];
    if (value == null) continue;
    const normalized = typeof value === 'string' ? value.trim() : value;
    if (secretFields.has(field) && normalized === '') continue;
    if (field === 'environment' && !['sandbox', 'production'].includes(normalized)) continue;
    if (field === 'payMethod' && !['paybill', 'buygoods'].includes(normalized)) continue;
    output[field] = normalized;
  }
  return output;
}

function serializePaymentConfig(value, providerValue) {
  const source = plainObject(value);
  const provider = normalizePaymentProvider(providerValue || source.provider);
  if (!provider) return { configured: false, credentials: {}, provider: null };

  const response = {
    configured: Boolean(value),
    credentials: {},
    provider,
  };
  for (const field of PAYMENT_SAFE_FIELDS[provider]) {
    if (source[field] !== undefined) response[field] = source[field];
  }
  for (const field of PAYMENT_SECRET_FIELDS[provider]) {
    response.credentials[field] = Boolean(source[field]);
  }
  if (source.updatedAt) response.updatedAt = source.updatedAt;
  return response;
}

function sanitizeSmsSettingsInput(input = {}) {
  const output = {};
  const copyBoolean = (path, value) => {
    if (typeof value === 'boolean') output[path] = value;
  };
  const copyString = (path, value, { allowBlank = true, max = 512 } = {}) => {
    if (typeof value !== 'string') return;
    const normalized = value.trim().slice(0, max);
    if (allowBlank || normalized) output[path] = normalized;
  };

  copyBoolean('enabled', input.enabled);
  copyBoolean('fallbackEnabled', input.fallbackEnabled);
  copyBoolean('autoSendOnCreate', input.autoSendOnCreate);
  copyBoolean('autoSendOnPlanChange', input.autoSendOnPlanChange);
  copyString('defaultLanguage', input.defaultLanguage, { max: 16 });
  copyString('senderId', input.senderId, { max: 64 });
  copyString('autoTemplateType', input.autoTemplateType, { max: 64 });
  if (['twilio', 'africastalking', 'textsms'].includes(input.primaryProvider)) {
    output.primaryProvider = input.primaryProvider;
  }

  copyString('twilio.accountSid', input.twilio?.accountSid, { allowBlank: false });
  copyString('twilio.authToken', input.twilio?.authToken, { allowBlank: false });
  copyString('twilio.from', input.twilio?.from, { max: 64 });
  copyString('africastalking.apiKey', input.africastalking?.apiKey, { allowBlank: false });
  copyString('africastalking.username', input.africastalking?.username, { allowBlank: false, max: 128 });
  copyString('africastalking.from', input.africastalking?.from, { max: 64 });
  copyBoolean('africastalking.useSandbox', input.africastalking?.useSandbox);
  copyString('textsms.apiKey', input.textsms?.apiKey, { allowBlank: false });
  copyString('textsms.partnerId', input.textsms?.partnerId, { allowBlank: false, max: 128 });
  copyString('textsms.sender', input.textsms?.sender, { max: 64 });
  copyString('textsms.baseUrl', input.textsms?.baseUrl, { max: 512 });

  copyBoolean('schedule.reminder5Days', input.schedule?.reminder5Days);
  copyBoolean('schedule.reminder3Days', input.schedule?.reminder3Days);
  const dueWarnHours = Number(input.schedule?.dueWarnHours);
  if (Number.isFinite(dueWarnHours) && dueWarnHours >= 0 && dueWarnHours <= 168) {
    output['schedule.dueWarnHours'] = dueWarnHours;
  }

  return output;
}

function serializeSmsSettings(value) {
  const source = plainObject(value);
  return {
    configured: Boolean(value),
    enabled: source.enabled === true,
    defaultLanguage: source.defaultLanguage || 'en',
    senderId: source.senderId || '',
    primaryProvider: source.primaryProvider || 'twilio',
    fallbackEnabled: source.fallbackEnabled === true,
    twilio: {
      from: source.twilio?.from || '',
      accountSidConfigured: Boolean(source.twilio?.accountSid),
      authTokenConfigured: Boolean(source.twilio?.authToken),
    },
    africastalking: {
      from: source.africastalking?.from || '',
      useSandbox: source.africastalking?.useSandbox === true,
      apiKeyConfigured: Boolean(source.africastalking?.apiKey),
      usernameConfigured: Boolean(source.africastalking?.username),
    },
    textsms: {
      sender: source.textsms?.sender || '',
      baseUrl: source.textsms?.baseUrl || '',
      apiKeyConfigured: Boolean(source.textsms?.apiKey),
      partnerIdConfigured: Boolean(source.textsms?.partnerId),
    },
    schedule: {
      reminder5Days: source.schedule?.reminder5Days !== false,
      reminder3Days: source.schedule?.reminder3Days !== false,
      dueWarnHours: Number(source.schedule?.dueWarnHours ?? 4),
    },
    autoSendOnCreate: source.autoSendOnCreate === true,
    autoSendOnPlanChange: source.autoSendOnPlanChange === true,
    autoTemplateType: source.autoTemplateType || 'payment-link',
    updatedAt: source.updatedAt || null,
  };
}

module.exports = {
  PAYMENT_PROVIDER_FIELDS,
  PAYMENT_SECRET_FIELDS,
  normalizePaymentProvider,
  sanitizePaymentConfigInput,
  sanitizeSmsSettingsInput,
  serializePaymentConfig,
  serializeSmsSettings,
};
