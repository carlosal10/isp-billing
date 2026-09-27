'use strict';

const assert = require('assert');
const test = require('node:test');

const {
  decryptField,
  decryptPaymentConfig,
  decryptSmsSettings,
  encryptField,
  getEncryptionKeyring,
  isEncryptedField,
  reencryptField,
} = require('../security/fieldEncryption');
const {
  buildSecretPatch,
  encryptedKeyId,
} = require('../scripts/encrypt-configuration-secrets');

const OLD_KEY = Buffer.alloc(32, 1).toString('base64');
const NEW_KEY = Buffer.alloc(32, 2).toString('base64');

function keyring(activeKeyId = 'old') {
  return getEncryptionKeyring({
    DATA_ENCRYPTION_ACTIVE_KEY_ID: activeKeyId,
    DATA_ENCRYPTION_KEYS: JSON.stringify({ old: OLD_KEY, next: NEW_KEY }),
  });
}

test('field encryption round-trips with authenticated AES-GCM ciphertext', () => {
  const ring = keyring();
  const ciphertext = encryptField('router-password', { keyring: ring });
  assert.equal(isEncryptedField(ciphertext), true);
  assert.equal(encryptedKeyId(ciphertext), 'old');
  assert.equal(decryptField(ciphertext, { keyring: ring }), 'router-password');
  assert.notEqual(ciphertext, encryptField('router-password', { keyring: ring }));

  const tampered = `${ciphertext.slice(0, -1)}${ciphertext.endsWith('A') ? 'B' : 'A'}`;
  assert.throws(() => decryptField(tampered, { keyring: ring }));
});

test('keyring supports rotation while retaining old-key decryption', () => {
  const oldCiphertext = encryptField('provider-secret', { keyring: keyring('old') });
  const rotated = reencryptField(oldCiphertext, { keyring: keyring('next') });

  assert.equal(encryptedKeyId(oldCiphertext), 'old');
  assert.equal(encryptedKeyId(rotated), 'next');
  assert.equal(decryptField(rotated, { keyring: keyring('next') }), 'provider-secret');
});

test('decrypt helpers support legacy plaintext during migration and decrypt copied configs', () => {
  assert.equal(decryptField('legacy-plaintext', { keyring: keyring() }), 'legacy-plaintext');
  const ring = keyring();
  const payment = decryptPaymentConfig({
    provider: 'mpesa',
    consumerKey: encryptField('consumer', { keyring: ring }),
    consumerSecret: encryptField('secret', { keyring: ring }),
  }, { keyring: ring });
  assert.equal(payment.consumerKey, 'consumer');
  assert.equal(payment.consumerSecret, 'secret');

  const sms = decryptSmsSettings({
    twilio: { authToken: encryptField('twilio-secret', { keyring: ring }) },
  }, { keyring: ring });
  assert.equal(sms.twilio.authToken, 'twilio-secret');
});

test('secret migration patch encrypts plaintext and rotates old ciphertext only', () => {
  const oldRing = keyring('old');
  const nextRing = keyring('next');
  const oldCiphertext = encryptField('old-secret', { keyring: oldRing });
  const plan = buildSecretPatch({
    password: 'plain-secret',
    nested: { token: oldCiphertext },
  }, ['password', 'nested.token'], { keyring: nextRing, rotate: false });

  assert.equal(decryptField(plan.password, { keyring: nextRing }), 'plain-secret');
  assert.equal(Object.hasOwn(plan, 'nested.token'), false);

  const rotation = buildSecretPatch({ nested: { token: oldCiphertext } }, ['nested.token'], {
    keyring: nextRing,
    rotate: true,
  });
  assert.equal(encryptedKeyId(rotation['nested.token']), 'next');
  assert.equal(decryptField(rotation['nested.token'], { keyring: nextRing }), 'old-secret');
});
