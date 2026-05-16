'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateHealthScore,
  countBySeverity,
  healthLabel,
  makeIssue,
  moduleStatusFromIssues,
  severityRank,
  tenantMatchValue,
} = require('../services/opsHealthService');

test('calculateHealthScore applies weighted penalties and clamps at zero', () => {
  const issues = [
    makeIssue({ severity: 'critical', code: 'a', module: 'x' }),
    makeIssue({ severity: 'warning', code: 'b', module: 'x' }),
    makeIssue({ severity: 'info', code: 'c', module: 'x' }),
  ];

  assert.equal(calculateHealthScore(issues), 65);
  assert.equal(calculateHealthScore(new Array(10).fill(makeIssue({ severity: 'critical', code: 'x', module: 'x' }))), 0);
});

test('healthLabel maps score ranges into operator friendly states', () => {
  assert.equal(healthLabel(95), 'healthy');
  assert.equal(healthLabel(80), 'watch');
  assert.equal(healthLabel(60), 'degraded');
  assert.equal(healthLabel(30), 'critical');
});

test('countBySeverity and moduleStatusFromIssues summarize issue state', () => {
  const issues = [
    makeIssue({ severity: 'warning', code: 'one', module: 'jobs' }),
    makeIssue({ severity: 'critical', code: 'two', module: 'jobs' }),
    makeIssue({ severity: 'info', code: 'three', module: 'jobs' }),
  ];

  assert.deepEqual(countBySeverity(issues), { critical: 1, warning: 1, info: 1 });
  assert.equal(moduleStatusFromIssues(issues), 'critical');
  assert.equal(moduleStatusFromIssues([issues[0]]), 'watch');
  assert.equal(moduleStatusFromIssues([]), 'healthy');
});

test('severityRank sorts critical issues above warnings and info', () => {
  assert.equal(severityRank('critical') > severityRank('warning'), true);
  assert.equal(severityRank('warning') > severityRank('info'), true);
  assert.equal(severityRank('unknown'), 0);
});

test('tenantMatchValue preserves non-object-id tenant ids for aggregate safety', () => {
  assert.equal(tenantMatchValue('tenant-slug'), 'tenant-slug');
  assert.equal(String(tenantMatchValue('507f1f77bcf86cd799439011')), '507f1f77bcf86cd799439011');
});
