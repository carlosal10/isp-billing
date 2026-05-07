'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assessSmsPermission,
  isWithinQuietHours,
  normalizeCommunicationPreferences,
  serializeCommunicationPreferences,
} = require('../services/customerCommunicationPreferencesService');

test('normalizeCommunicationPreferences applies safe commercial defaults', () => {
  const prefs = normalizeCommunicationPreferences({});
  assert.equal(prefs.preferredLanguage, 'en');
  assert.equal(prefs.transactionalSmsEnabled, true);
  assert.equal(prefs.billingSmsEnabled, true);
  assert.equal(prefs.serviceAlertsSmsEnabled, true);
  assert.equal(prefs.marketingSmsEnabled, false);
  assert.equal(prefs.quietHours.start, '21:00');
});

test('serializeCommunicationPreferences redacts to preference-only fields', () => {
  const prefs = serializeCommunicationPreferences({
    communicationPreferences: {
      preferredLanguage: 'sw',
      marketingSmsEnabled: true,
      quietHours: { enabled: true, start: '22:00', end: '06:00', timezone: 'Africa/Nairobi' },
    },
    phone: '+254700000000',
  });

  assert.equal(prefs.preferredLanguage, 'sw');
  assert.equal(prefs.marketingSmsEnabled, true);
  assert.equal(Object.hasOwn(prefs, 'phone'), false);
});

test('isWithinQuietHours supports quiet windows that cross midnight', () => {
  const prefs = {
    quietHours: {
      enabled: true,
      start: '21:00',
      end: '07:00',
      timezone: 'UTC',
    },
  };

  assert.equal(isWithinQuietHours(prefs, new Date('2026-05-07T22:30:00Z')), true);
  assert.equal(isWithinQuietHours(prefs, new Date('2026-05-07T06:30:00Z')), true);
  assert.equal(isWithinQuietHours(prefs, new Date('2026-05-07T12:30:00Z')), false);
});

test('assessSmsPermission denies suppressed billing and marketing messages', () => {
  const billingDenied = assessSmsPermission({
    communicationPreferences: {
      billingSmsEnabled: false,
    },
  }, { category: 'payment-link' });

  const marketingDenied = assessSmsPermission({
    communicationPreferences: {
      marketingSmsEnabled: false,
    },
  }, { category: 'marketing' });

  assert.equal(billingDenied.allowed, false);
  assert.equal(billingDenied.reason, 'billing_sms_disabled');
  assert.equal(marketingDenied.allowed, false);
  assert.equal(marketingDenied.reason, 'marketing_sms_disabled');
});

test('assessSmsPermission allows service alerts when enabled', () => {
  const result = assessSmsPermission({
    communicationPreferences: {
      transactionalSmsEnabled: true,
      serviceAlertsSmsEnabled: true,
      quietHours: { enabled: false },
    },
  }, { category: 'outage' });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, null);
});
