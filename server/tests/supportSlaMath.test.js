'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addMinutes,
  computeTicketSla,
  normalizePriority,
} = require('../services/supportSlaMath');

test('normalizePriority falls back to medium for unknown values', () => {
  assert.equal(normalizePriority('urgent'), 'urgent');
  assert.equal(normalizePriority(''), 'medium');
  assert.equal(normalizePriority('escalated'), 'medium');
});

test('addMinutes offsets valid dates and survives invalid inputs', () => {
  const base = new Date('2026-04-27T08:00:00.000Z');
  assert.equal(addMinutes(base, 90).toISOString(), '2026-04-27T09:30:00.000Z');
  assert.equal(Number.isFinite(addMinutes('not-a-date', 15).getTime()), true);
});

test('computeTicketSla uses priority-specific response and resolution windows', () => {
  const urgent = computeTicketSla('urgent', '2026-04-27T08:00:00.000Z');
  const low = computeTicketSla('low', '2026-04-27T08:00:00.000Z');

  assert.equal(urgent.firstResponseDueAt.toISOString(), '2026-04-27T08:15:00.000Z');
  assert.equal(urgent.resolutionDueAt.toISOString(), '2026-04-27T09:00:00.000Z');
  assert.equal(low.firstResponseDueAt.toISOString(), '2026-04-28T08:00:00.000Z');
  assert.equal(low.resolutionDueAt.toISOString(), '2026-04-30T08:00:00.000Z');
});
