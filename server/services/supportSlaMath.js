'use strict';

const PRIORITY_MINUTES = {
  urgent: 60,
  high: 4 * 60,
  medium: 24 * 60,
  low: 72 * 60,
};

const RESPONSE_MINUTES = {
  urgent: 15,
  high: 60,
  medium: 4 * 60,
  low: 24 * 60,
};

function normalizePriority(value) {
  const priority = String(value || '').trim().toLowerCase();
  if (PRIORITY_MINUTES[priority]) return priority;
  return 'medium';
}

function addMinutes(date, minutes) {
  const base = date ? new Date(date) : new Date();
  const safe = Number.isFinite(base.getTime()) ? base : new Date();
  return new Date(safe.getTime() + Number(minutes || 0) * 60 * 1000);
}

function computeTicketSla(priority, createdAt = new Date()) {
  const normalized = normalizePriority(priority);
  return {
    priority: normalized,
    firstResponseDueAt: addMinutes(createdAt, RESPONSE_MINUTES[normalized]),
    resolutionDueAt: addMinutes(createdAt, PRIORITY_MINUTES[normalized]),
  };
}

module.exports = {
  addMinutes,
  computeTicketSla,
  normalizePriority,
};
