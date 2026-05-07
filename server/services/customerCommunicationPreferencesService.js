'use strict';

const Customer = require('../models/customers');
const AuditLog = require('../models/AuditLog');

const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || 'Africa/Nairobi';
const DEFAULT_PREFERENCES = Object.freeze({
  preferredLanguage: 'en',
  transactionalSmsEnabled: true,
  billingSmsEnabled: true,
  serviceAlertsSmsEnabled: true,
  marketingSmsEnabled: false,
  doNotContactUntil: null,
  quietHours: {
    enabled: false,
    start: '21:00',
    end: '07:00',
    timezone: DEFAULT_TIMEZONE,
  },
});

const SMS_CATEGORY_MAP = {
  billing: 'billingSmsEnabled',
  collections: 'billingSmsEnabled',
  dunning: 'billingSmsEnabled',
  payment: 'billingSmsEnabled',
  'payment-link': 'billingSmsEnabled',
  reminder: 'billingSmsEnabled',
  service: 'serviceAlertsSmsEnabled',
  service_alert: 'serviceAlertsSmsEnabled',
  support: 'serviceAlertsSmsEnabled',
  outage: 'serviceAlertsSmsEnabled',
  maintenance: 'serviceAlertsSmsEnabled',
  marketing: 'marketingSmsEnabled',
};

function serviceError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function actorId(actor = {}) {
  return String(actor.id || actor.email || actor.sub || actor._id || '').trim() || null;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return /^(1|true|yes|on)$/i.test(value.trim());
  return Boolean(value);
}

function parseNullableDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw serviceError(400, 'doNotContactUntil must be a valid date');
  }
  return date;
}

function normalizeTime(value, fallback) {
  const text = String(value || fallback || '').trim();
  const match = text.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw serviceError(400, 'quiet hour times must use HH:mm');
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

function normalizeLanguage(value, fallback = DEFAULT_PREFERENCES.preferredLanguage) {
  const text = String(value || fallback || 'en').trim().toLowerCase();
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(text)) {
    throw serviceError(400, 'preferredLanguage must be a valid language code');
  }
  return text.slice(0, 16);
}

function serializeCommunicationPreferences(customerOrPreferences) {
  const raw = customerOrPreferences?.communicationPreferences || customerOrPreferences || {};
  const quiet = raw.quietHours || {};
  return {
    preferredLanguage: normalizeLanguage(raw.preferredLanguage, DEFAULT_PREFERENCES.preferredLanguage),
    transactionalSmsEnabled: parseBoolean(raw.transactionalSmsEnabled, DEFAULT_PREFERENCES.transactionalSmsEnabled),
    billingSmsEnabled: parseBoolean(raw.billingSmsEnabled, DEFAULT_PREFERENCES.billingSmsEnabled),
    serviceAlertsSmsEnabled: parseBoolean(raw.serviceAlertsSmsEnabled, DEFAULT_PREFERENCES.serviceAlertsSmsEnabled),
    marketingSmsEnabled: parseBoolean(raw.marketingSmsEnabled, DEFAULT_PREFERENCES.marketingSmsEnabled),
    doNotContactUntil: raw.doNotContactUntil || null,
    quietHours: {
      enabled: parseBoolean(quiet.enabled, DEFAULT_PREFERENCES.quietHours.enabled),
      start: normalizeTime(quiet.start, DEFAULT_PREFERENCES.quietHours.start),
      end: normalizeTime(quiet.end, DEFAULT_PREFERENCES.quietHours.end),
      timezone: String(quiet.timezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE,
    },
    updatedAt: raw.updatedAt || null,
    updatedBy: raw.updatedBy || null,
  };
}

function normalizeCommunicationPreferences(input = {}, existing = {}) {
  const base = serializeCommunicationPreferences(existing);
  const quietInput = input.quietHours || {};
  const hasQuietHours = Object.prototype.hasOwnProperty.call(input, 'quietHours');

  return {
    preferredLanguage:
      input.preferredLanguage !== undefined
        ? normalizeLanguage(input.preferredLanguage, base.preferredLanguage)
        : base.preferredLanguage,
    transactionalSmsEnabled: parseBoolean(input.transactionalSmsEnabled, base.transactionalSmsEnabled),
    billingSmsEnabled: parseBoolean(input.billingSmsEnabled, base.billingSmsEnabled),
    serviceAlertsSmsEnabled: parseBoolean(input.serviceAlertsSmsEnabled, base.serviceAlertsSmsEnabled),
    marketingSmsEnabled: parseBoolean(input.marketingSmsEnabled, base.marketingSmsEnabled),
    doNotContactUntil:
      Object.prototype.hasOwnProperty.call(input, 'doNotContactUntil')
        ? parseNullableDate(input.doNotContactUntil)
        : base.doNotContactUntil,
    quietHours: {
      enabled: hasQuietHours ? parseBoolean(quietInput.enabled, base.quietHours.enabled) : base.quietHours.enabled,
      start: hasQuietHours ? normalizeTime(quietInput.start, base.quietHours.start) : base.quietHours.start,
      end: hasQuietHours ? normalizeTime(quietInput.end, base.quietHours.end) : base.quietHours.end,
      timezone: hasQuietHours
        ? String(quietInput.timezone || base.quietHours.timezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE
        : base.quietHours.timezone,
    },
  };
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || '00:00').split(':').map(Number);
  return hours * 60 + minutes;
}

function localMinutesForTimezone(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone || DEFAULT_TIMEZONE,
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
    return hour * 60 + minute;
  } catch {
    const local = new Date(date);
    return local.getHours() * 60 + local.getMinutes();
  }
}

function isWithinQuietHours(preferences, date = new Date()) {
  const prefs = serializeCommunicationPreferences(preferences);
  if (!prefs.quietHours.enabled) return false;

  const start = timeToMinutes(prefs.quietHours.start);
  const end = timeToMinutes(prefs.quietHours.end);
  const current = localMinutesForTimezone(date, prefs.quietHours.timezone);

  if (start === end) return false;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

function categoryKey(category) {
  const raw = String(category || 'billing').toLowerCase().trim();
  if (raw.startsWith('reminder-')) return 'billingSmsEnabled';
  return SMS_CATEGORY_MAP[raw] || 'billingSmsEnabled';
}

function disabledReasonForKey(key) {
  if (key === 'billingSmsEnabled') return 'billing_sms_disabled';
  if (key === 'serviceAlertsSmsEnabled') return 'service_alert_sms_disabled';
  if (key === 'marketingSmsEnabled') return 'marketing_sms_disabled';
  return 'sms_disabled';
}

function assessSmsPermission(customer, options = {}) {
  const prefs = serializeCommunicationPreferences(customer);
  const category = String(options.category || 'billing').toLowerCase().trim();
  const key = categoryKey(category);
  const now = options.now || new Date();

  if (prefs.transactionalSmsEnabled !== true && key !== 'marketingSmsEnabled') {
    return { allowed: false, reason: 'transactional_sms_disabled', preferences: prefs };
  }
  if (prefs[key] !== true) {
    return { allowed: false, reason: disabledReasonForKey(key), preferences: prefs };
  }
  if (prefs.doNotContactUntil && new Date(prefs.doNotContactUntil) > now) {
    return { allowed: false, reason: 'do_not_contact_window_active', preferences: prefs };
  }
  if (isWithinQuietHours(prefs, now)) {
    return { allowed: false, reason: 'quiet_hours_active', preferences: prefs };
  }

  return { allowed: true, reason: null, preferences: prefs };
}

async function updateCustomerCommunicationPreferences({ tenantId, customerId, payload = {}, actor = {} }) {
  const customer = await Customer.findOne({ _id: customerId, tenantId });
  if (!customer) throw serviceError(404, 'Customer not found');

  const previous = serializeCommunicationPreferences(customer);
  const normalized = normalizeCommunicationPreferences(payload, customer);
  customer.communicationPreferences = {
    ...normalized,
    updatedAt: new Date(),
    updatedBy: actorId(actor),
  };
  await customer.save();

  await AuditLog.create({
    tenantId,
    actor: actorId(actor),
    action: 'customer.communication-preferences.update',
    payload: {
      customerId: String(customer._id),
      accountNumber: customer.accountNumber || null,
      before: previous,
      after: serializeCommunicationPreferences(customer),
    },
  }).catch(() => null);

  return {
    customerId: String(customer._id),
    accountNumber: customer.accountNumber || null,
    name: customer.name || null,
    communicationPreferences: serializeCommunicationPreferences(customer),
  };
}

module.exports = {
  DEFAULT_PREFERENCES,
  assessSmsPermission,
  isWithinQuietHours,
  normalizeCommunicationPreferences,
  serializeCommunicationPreferences,
  updateCustomerCommunicationPreferences,
};
