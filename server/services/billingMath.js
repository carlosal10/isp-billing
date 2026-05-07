'use strict';

function roundCurrency(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

function clampPositive(value) {
  return Math.max(0, roundCurrency(value));
}

function addDays(value, days) {
  const base = new Date(value);
  if (Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() + Math.round(Number(days || 0)) * 86400000);
}

function diffDays(later, earlier) {
  const a = new Date(later);
  const b = new Date(earlier);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.floor((a.getTime() - b.getTime()) / 86400000);
}

function servicePeriodFromExpiry(expiryDate, durationDays) {
  const end = expiryDate ? new Date(expiryDate) : null;
  if (!end || Number.isNaN(end.getTime()) || !Number.isFinite(Number(durationDays)) || Number(durationDays) <= 0) {
    return { servicePeriodStart: null, servicePeriodEnd: end };
  }
  return {
    servicePeriodStart: addDays(end, -Number(durationDays)),
    servicePeriodEnd: end,
  };
}

function computeInvoiceStatus({ total = 0, amountPaid = 0, amountCredited = 0, dueDate = null, currentDate = new Date(), explicitStatus = null }) {
  if (explicitStatus === 'voided') return 'voided';
  const balance = clampPositive(roundCurrency(total) - roundCurrency(amountPaid) - roundCurrency(amountCredited));
  if (balance <= 0) return 'paid';
  if (roundCurrency(amountPaid) > 0 || roundCurrency(amountCredited) > 0) return 'partially_paid';
  if (!dueDate) return 'issued';
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return 'issued';
  const dueDay = new Date(due);
  const currentDay = new Date(currentDate);
  dueDay.setHours(0, 0, 0, 0);
  currentDay.setHours(0, 0, 0, 0);
  return dueDay.getTime() < currentDay.getTime() ? 'overdue' : 'issued';
}

function allocateAmountOldestFirst(items, amount) {
  let remaining = clampPositive(amount);
  const allocations = [];

  for (const item of Array.isArray(items) ? items : []) {
    if (remaining <= 0) break;
    const outstanding = clampPositive(item.outstanding);
    if (outstanding <= 0) continue;
    const applied = clampPositive(Math.min(outstanding, remaining));
    if (applied <= 0) continue;
    allocations.push({
      itemId: item.itemId,
      amount: applied,
      item,
    });
    remaining = clampPositive(remaining - applied);
  }

  return {
    allocations,
    remaining,
    appliedTotal: clampPositive(amount) - remaining,
  };
}

function computeProrationDelta({
  oldPrice = 0,
  oldDurationDays = 0,
  newPrice = 0,
  newDurationDays = 0,
  remainingDays = 0,
}) {
  const safeRemaining = Math.max(0, Number(remainingDays || 0));
  const oldDaily = Number(oldDurationDays) > 0 ? Number(oldPrice || 0) / Number(oldDurationDays) : 0;
  const newDaily = Number(newDurationDays) > 0 ? Number(newPrice || 0) / Number(newDurationDays) : 0;
  return roundCurrency((newDaily - oldDaily) * safeRemaining);
}

function agingBucket(daysOverdue) {
  const days = Math.max(0, Number(daysOverdue || 0));
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

function computeDunningStage({ dueDate, graceDays = 3, currentDate = new Date() }) {
  if (!dueDate) return 'none';
  const days = diffDays(currentDate, dueDate);
  if (days < 0) return 'upcoming';
  if (days === 0) return 'due';
  if (days <= Math.max(0, Number(graceDays || 0))) return 'grace';
  if (days <= 14) return 'final-notice';
  if (days <= 30) return 'collections';
  return 'suspended';
}

module.exports = {
  roundCurrency,
  clampPositive,
  addDays,
  diffDays,
  servicePeriodFromExpiry,
  computeInvoiceStatus,
  allocateAmountOldestFirst,
  computeProrationDelta,
  agingBucket,
  computeDunningStage,
};
