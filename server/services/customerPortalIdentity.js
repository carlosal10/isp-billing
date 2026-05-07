'use strict';

const { normalizeMsisdn } = require('../utils/stkPush');

function normalizePortalTenantLookup(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePortalAccountNumber(value) {
  return String(value || '').trim().toUpperCase();
}

function matchesCustomerCredential(customer, credential) {
  const probe = String(credential || '').trim();
  if (!probe) return false;

  const email = String(customer?.email || '').trim().toLowerCase();
  const phoneRaw = String(customer?.phone || '').trim();
  const normalizedProbePhone = normalizeMsisdn(probe);
  const normalizedCustomerPhone = normalizeMsisdn(phoneRaw);

  if (email && probe.toLowerCase() === email) return true;
  if (phoneRaw && probe === phoneRaw) return true;
  if (normalizedProbePhone && normalizedCustomerPhone && normalizedProbePhone === normalizedCustomerPhone) {
    return true;
  }
  return false;
}

module.exports = {
  matchesCustomerCredential,
  normalizePortalAccountNumber,
  normalizePortalTenantLookup,
};
