'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

function coerceDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDurationToDays(value) {
  if (value == null) return NaN;
  if (typeof value === 'number') return value;

  const normalized = String(value).trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(normalized)) return Number(normalized);

  const match = normalized.match(/(\d+(\.\d+)?)\s*(day|week|month|year)s?/);
  if (match) {
    const n = parseFloat(match[1]);
    const unit = match[3];
    if (unit === 'day') return n;
    if (unit === 'week') return n * 7;
    if (unit === 'month') return n * 30;
    if (unit === 'year') return n * 365;
  }

  if (normalized === 'monthly' || normalized === 'month') return 30;
  if (normalized === 'weekly' || normalized === 'week') return 7;
  if (normalized === 'yearly' || normalized === 'annual' || normalized === 'year') return 365;

  const num = parseFloat(normalized.replace(/[^\d.]/g, ''));
  return Number.isFinite(num) ? num : NaN;
}

function resolvePlanDurationDays(plan) {
  const direct = Number(plan?.durationDays);
  if (Number.isFinite(direct) && direct > 0) return direct;
  return parseDurationToDays(plan?.duration);
}

function resolveEntitlementAnchor({
  customerExpiryDate,
  referenceDate = new Date(),
  overrideAnchorDate = null,
} = {}) {
  const override = coerceDate(overrideAnchorDate);
  if (override) return override;

  const reference = coerceDate(referenceDate) || new Date();
  const currentExpiry = coerceDate(customerExpiryDate);
  if (currentExpiry && currentExpiry.getTime() > reference.getTime()) {
    return currentExpiry;
  }
  return reference;
}

function computeExpiryDate({
  plan,
  customerExpiryDate,
  referenceDate = new Date(),
  overrideAnchorDate = null,
  expiryDate = null,
  extendDays = 0,
} = {}) {
  const explicitExpiry = coerceDate(expiryDate);
  const durationDays = resolvePlanDurationDays(plan);
  if (!explicitExpiry && (!Number.isFinite(durationDays) || durationDays <= 0)) {
    return null;
  }

  let computed = explicitExpiry;
  if (!computed) {
    const anchor = resolveEntitlementAnchor({
      customerExpiryDate,
      referenceDate,
      overrideAnchorDate,
    });
    computed = new Date(anchor.getTime() + durationDays * DAY_MS);
  }

  const extra = Number(extendDays);
  if (Number.isFinite(extra) && extra !== 0) {
    computed = new Date(computed.getTime() + Math.round(extra) * DAY_MS);
  }

  return computed;
}

module.exports = {
  coerceDate,
  parseDurationToDays,
  resolvePlanDurationDays,
  resolveEntitlementAnchor,
  computeExpiryDate,
};
