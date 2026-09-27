'use strict';

const assert = require('assert');
const test = require('node:test');

const {
  normalizePaymentProvider,
  sanitizePaymentConfigInput,
  sanitizeSmsSettingsInput,
  serializePaymentConfig,
  serializeSmsSettings,
} = require('../services/configurationSanitizer');

test('payment configuration sanitizer allowlists provider fields and preserves stored secrets on blank input', () => {
  assert.equal(normalizePaymentProvider(' MPeSa '), 'mpesa');
  assert.equal(normalizePaymentProvider('unknown'), null);

  const sanitized = sanitizePaymentConfigInput('mpesa', {
    consumerKey: ' new-key ',
    consumerSecret: '',
    environment: 'production',
    ispId: 'attacker-tenant',
    provider: 'stripe',
    unexpected: 'value',
  });

  assert.deepEqual(sanitized, {
    consumerKey: 'new-key',
    environment: 'production',
  });
  assert.equal(Object.hasOwn(sanitized, 'consumerSecret'), false);
  assert.equal(Object.hasOwn(sanitized, 'ispId'), false);
  assert.equal(Object.hasOwn(sanitized, 'provider'), false);
});

test('payment configuration serializer returns status without returning credentials', () => {
  const response = serializePaymentConfig({
    provider: 'mpesa',
    businessName: 'Example ISP',
    payMethod: 'paybill',
    paybillShortcode: '123456',
    consumerKey: 'consumer-key',
    consumerSecret: 'consumer-secret',
    paybillPasskey: 'passkey',
    ispId: 'tenant-a',
  });

  assert.equal(response.configured, true);
  assert.equal(response.businessName, 'Example ISP');
  assert.deepEqual(response.credentials, {
    consumerKey: true,
    consumerSecret: true,
    paybillPasskey: true,
    buyGoodsPasskey: false,
  });
  const serialized = JSON.stringify(response);
  assert.doesNotMatch(serialized, /consumer-secret|consumer-key|passkey|tenant-a/);
});

test('SMS configuration sanitizer ignores tenant and blank credential replacement fields', () => {
  const sanitized = sanitizeSmsSettingsInput({
    tenantId: 'attacker-tenant',
    enabled: true,
    primaryProvider: 'twilio',
    twilio: { accountSid: '', authToken: ' next-token ', from: ' +15550001111 ' },
    schedule: { dueWarnHours: 6 },
  });

  assert.deepEqual(sanitized, {
    enabled: true,
    primaryProvider: 'twilio',
    'twilio.authToken': 'next-token',
    'twilio.from': '+15550001111',
    'schedule.dueWarnHours': 6,
  });
});

test('SMS configuration serializer exposes configured flags instead of secret values', () => {
  const response = serializeSmsSettings({
    enabled: true,
    primaryProvider: 'twilio',
    twilio: { accountSid: 'AC123', authToken: 'secret-token', from: '+15550001111' },
    africastalking: { apiKey: 'secret-api-key', username: 'sandbox' },
  });

  assert.equal(response.twilio.accountSidConfigured, true);
  assert.equal(response.twilio.authTokenConfigured, true);
  assert.equal(response.africastalking.apiKeyConfigured, true);
  assert.equal(response.africastalking.usernameConfigured, true);
  assert.doesNotMatch(JSON.stringify(response), /AC123|secret-token|secret-api-key|sandbox/);
});
