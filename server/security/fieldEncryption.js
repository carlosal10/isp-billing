'use strict';

const crypto = require('crypto');

const ENCRYPTED_PREFIX = 'enc:v1:';
const FIELD_AAD_PREFIX = 'swiftbridge-field-v1';

const PAYMENT_SECRET_FIELDS = Object.freeze({
  mpesa: ['consumerKey', 'consumerSecret', 'paybillPasskey', 'buyGoodsPasskey'],
  paypal: ['clientId', 'clientSecret'],
  stripe: ['secretKey'],
});
const SMS_SECRET_PATHS = Object.freeze([
  'twilio.accountSid',
  'twilio.authToken',
  'africastalking.apiKey',
  'africastalking.username',
  'textsms.apiKey',
  'textsms.partnerId',
]);

function decodeKeyMaterial(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Encryption key material is empty');
  let key;
  if (/^[a-f0-9]{64}$/i.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
    key = Buffer.from(normalized, 'base64');
  }
  if (key.length !== 32) {
    throw new Error('Encryption keys must decode to exactly 32 bytes');
  }
  return key;
}

function getEncryptionKeyring(env = process.env) {
  const keys = new Map();
  let activeKeyId = String(env.DATA_ENCRYPTION_ACTIVE_KEY_ID || '').trim();

  if (String(env.DATA_ENCRYPTION_KEYS || '').trim()) {
    let parsed;
    try {
      parsed = JSON.parse(env.DATA_ENCRYPTION_KEYS);
    } catch {
      throw new Error('DATA_ENCRYPTION_KEYS must be a JSON object');
    }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('DATA_ENCRYPTION_KEYS must be a JSON object');
    }
    for (const [keyId, material] of Object.entries(parsed)) {
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(keyId)) {
        throw new Error(`Invalid encryption key id: ${keyId}`);
      }
      keys.set(keyId, decodeKeyMaterial(material));
    }
  } else if (String(env.DATA_ENCRYPTION_KEY || '').trim()) {
    activeKeyId = activeKeyId || 'primary';
    keys.set(activeKeyId, decodeKeyMaterial(env.DATA_ENCRYPTION_KEY));
  }

  if (!keys.size) throw new Error('DATA_ENCRYPTION_KEY or DATA_ENCRYPTION_KEYS is required');
  activeKeyId = activeKeyId || keys.keys().next().value;
  if (!keys.has(activeKeyId)) {
    throw new Error(`Active encryption key id is not present: ${activeKeyId}`);
  }
  return { activeKeyId, keys };
}

function isEncryptedField(value) {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function encryptField(value, options = {}) {
  if (value == null || value === '') return value;
  if (isEncryptedField(value)) return value;
  const keyring = options.keyring || getEncryptionKeyring(options.env);
  const keyId = keyring.activeKeyId;
  const key = keyring.keys.get(keyId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${FIELD_AAD_PREFIX}:${keyId}`));
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTED_PREFIX}${keyId}:${encode(iv)}:${encode(tag)}:${encode(encrypted)}`;
}

function decryptField(value, options = {}) {
  if (value == null || value === '' || !isEncryptedField(value)) return value;
  const parts = String(value).split(':');
  if (parts.length !== 6 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    throw new Error('Malformed encrypted field');
  }
  const [, , keyId, ivValue, tagValue, encryptedValue] = parts;
  const keyring = options.keyring || getEncryptionKeyring(options.env);
  const key = keyring.keys.get(keyId);
  if (!key) throw new Error(`Encryption key is unavailable: ${keyId}`);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64url'));
  decipher.setAAD(Buffer.from(`${FIELD_AAD_PREFIX}:${keyId}`));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function reencryptField(value, options = {}) {
  return encryptField(decryptField(value, options), options);
}

function clonePlain(value) {
  if (!value) return value;
  const source = typeof value.toObject === 'function' ? value.toObject() : value;
  return structuredClone(source);
}

function decryptPaymentConfig(value, options = {}) {
  const output = clonePlain(value);
  if (!output) return output;
  const fields = PAYMENT_SECRET_FIELDS[String(output.provider || 'mpesa').toLowerCase()] || [];
  fields.forEach((field) => {
    if (output[field] !== undefined) output[field] = decryptField(output[field], options);
  });
  return output;
}

function decryptSmsSettings(value, options = {}) {
  const output = clonePlain(value);
  if (!output) return output;
  SMS_SECRET_PATHS.forEach((path) => {
    const parts = path.split('.');
    const parent = output[parts[0]];
    if (parent?.[parts[1]] !== undefined) {
      parent[parts[1]] = decryptField(parent[parts[1]], options);
    }
  });
  return output;
}

module.exports = {
  ENCRYPTED_PREFIX,
  PAYMENT_SECRET_FIELDS,
  SMS_SECRET_PATHS,
  decodeKeyMaterial,
  decryptField,
  decryptPaymentConfig,
  decryptSmsSettings,
  encryptField,
  getEncryptionKeyring,
  isEncryptedField,
  reencryptField,
};
