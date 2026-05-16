'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPrivacyPolicyReport,
  evaluateRetentionControl,
  formatPrivacyPolicyReport,
  parsePositiveInteger,
} = require('../services/privacyPolicyService');

test('parsePositiveInteger accepts only safe positive day counts', () => {
  assert.equal(parsePositiveInteger('90'), 90);
  assert.equal(parsePositiveInteger('0'), Number.NaN);
  assert.equal(parsePositiveInteger('30 days'), Number.NaN);
  assert.equal(parsePositiveInteger(undefined), null);
});

test('evaluateRetentionControl uses defaults and warns when env is absent', () => {
  const result = evaluateRetentionControl({
    label: 'Audit logs',
    env: 'AUDIT_LOG_RETENTION_DAYS',
    defaultDays: 365,
    minDays: 30,
    maxDays: 2555,
  }, {});

  assert.equal(result.days, 365);
  assert.equal(result.source, 'default');
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 1);
});

test('buildPrivacyPolicyReport fails invalid retention bounds', () => {
  const report = buildPrivacyPolicyReport({
    AUDIT_LOG_RETENTION_DAYS: '7',
    MESSAGE_DELIVERY_RETENTION_DAYS: '365',
    PAYMENT_GATEWAY_EVENT_RETENTION_DAYS: '730',
    PLATFORM_GATEWAY_EVENT_ACTION_RETENTION_DAYS: '730',
    JOB_RUN_RETENTION_DAYS: '90',
    JOB_ACTION_RETENTION_DAYS: '180',
  });

  assert.equal(report.ok, false);
  assert.equal(report.errors.some((error) => error.key === 'AUDIT_LOG_RETENTION_DAYS'), true);
});

test('formatPrivacyPolicyReport produces operator-friendly output', () => {
  const report = buildPrivacyPolicyReport({
    AUDIT_LOG_RETENTION_DAYS: '365',
    MESSAGE_DELIVERY_RETENTION_DAYS: '365',
    PAYMENT_GATEWAY_EVENT_RETENTION_DAYS: '730',
    PLATFORM_GATEWAY_EVENT_ACTION_RETENTION_DAYS: '730',
    JOB_RUN_RETENTION_DAYS: '90',
    JOB_ACTION_RETENTION_DAYS: '180',
  });

  const text = formatPrivacyPolicyReport(report);

  assert.equal(report.ok, true);
  assert.match(text, /\[privacy\] retention policy/);
  assert.match(text, /\[privacy\] ok/);
});
