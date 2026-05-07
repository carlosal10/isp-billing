'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isActiveIncidentStatus,
  normalizeIncidentKind,
  normalizeIncidentSeverity,
  normalizeIncidentStatus,
} = require('../services/nocMath');

test('normalizeIncidentKind falls back to outage', () => {
  assert.equal(normalizeIncidentKind('maintenance'), 'maintenance');
  assert.equal(normalizeIncidentKind('mystery'), 'outage');
});

test('normalizeIncidentSeverity falls back to medium', () => {
  assert.equal(normalizeIncidentSeverity('critical'), 'critical');
  assert.equal(normalizeIncidentSeverity(''), 'medium');
});

test('normalizeIncidentStatus defaults maintenance to scheduled and outages to open', () => {
  assert.equal(normalizeIncidentStatus('maintenance', ''), 'scheduled');
  assert.equal(normalizeIncidentStatus('outage', ''), 'open');
  assert.equal(normalizeIncidentStatus('outage', 'monitoring'), 'monitoring');
});

test('isActiveIncidentStatus recognizes scheduled and open operational states', () => {
  assert.equal(isActiveIncidentStatus('scheduled'), true);
  assert.equal(isActiveIncidentStatus('investigating'), true);
  assert.equal(isActiveIncidentStatus('resolved'), false);
});
