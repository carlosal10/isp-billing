'use strict';

const bcrypt = require('bcryptjs');
const AuditLog = require('../models/AuditLog');
const Customer = require('../models/customers');

function serviceError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function requestActorId(actor = {}) {
  return String(actor.id || actor.email || actor.sub || actor._id || '').trim() || null;
}

function serializePortalProfile(customer) {
  const profile = customer?.portalProfile || {};
  return {
    customerId: customer?._id ? String(customer._id) : null,
    accountNumber: customer?.accountNumber || null,
    name: customer?.name || null,
    portalProfile: {
      isEnabled: profile.isEnabled !== false,
      hasPin: Boolean(profile.pinHash),
      lastLoginAt: profile.lastLoginAt || null,
      lastLoginMethod: profile.lastLoginMethod || null,
      lastSeenAt: profile.lastSeenAt || null,
    },
  };
}

function validatePortalPin(value) {
  const pin = String(value || '').trim();
  if (!/^\d{4,8}$/.test(pin)) {
    throw serviceError(400, 'Portal PIN must be 4 to 8 digits');
  }
  return pin;
}

function normalizePortalAccessPayload(payload = {}) {
  const hasEnabled = Object.prototype.hasOwnProperty.call(payload, 'isEnabled');
  const hasPin = Object.prototype.hasOwnProperty.call(payload, 'pin');
  const clearPin = payload.clearPin === true;

  if (hasEnabled && typeof payload.isEnabled !== 'boolean') {
    throw serviceError(400, 'isEnabled must be a boolean');
  }
  if (hasPin && clearPin) {
    throw serviceError(400, 'Choose either pin or clearPin, not both');
  }

  return {
    hasEnabled,
    isEnabled: payload.isEnabled,
    hasPin,
    pin: hasPin ? validatePortalPin(payload.pin) : null,
    clearPin,
    reason: typeof payload.reason === 'string' ? payload.reason.trim().slice(0, 500) : null,
  };
}

async function getCustomerPortalAccess(tenantId, customerId) {
  const customer = await Customer.findOne({ _id: customerId, tenantId }).lean();
  if (!customer) throw serviceError(404, 'Customer not found');
  return serializePortalProfile(customer);
}

async function updateCustomerPortalAccess({
  tenantId,
  customerId,
  payload = {},
  actor = {},
}) {
  const normalized = normalizePortalAccessPayload(payload);
  const customer = await Customer.findOne({ _id: customerId, tenantId });
  if (!customer) throw serviceError(404, 'Customer not found');

  const before = serializePortalProfile(customer);
  const changed = [];

  if (normalized.hasEnabled) {
    customer.set('portalProfile.isEnabled', normalized.isEnabled);
    changed.push('isEnabled');
  }

  if (normalized.hasPin) {
    customer.set('portalProfile.pinHash', await bcrypt.hash(normalized.pin, 12));
    changed.push('pin');
  } else if (normalized.clearPin) {
    customer.set('portalProfile.pinHash', null);
    changed.push('pin');
  }

  if (!changed.length) {
    throw serviceError(400, 'No portal access changes provided');
  }

  const updated = await customer.save();
  const after = serializePortalProfile(updated);

  await AuditLog.create({
    tenantId,
    actor: requestActorId(actor),
    action: 'customer.portal_access.update',
    routerHost: null,
    payload: {
      customerId: String(updated._id),
      accountNumber: updated.accountNumber || null,
      changed,
      reason: normalized.reason,
      before: before.portalProfile,
      after: after.portalProfile,
    },
  }).catch(() => null);

  return after;
}

module.exports = {
  getCustomerPortalAccess,
  normalizePortalAccessPayload,
  serializePortalProfile,
  updateCustomerPortalAccess,
  validatePortalPin,
};
