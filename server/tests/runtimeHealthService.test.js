'use strict';

const assert = require('assert');
const test = require('node:test');

const {
  buildLiveness,
  buildReadiness,
  connectionStateName,
  databaseStatus,
  readinessStatusCode,
} = require('../services/runtimeHealthService');

test('connectionStateName maps known mongoose states', () => {
  assert.equal(connectionStateName(0), 'disconnected');
  assert.equal(connectionStateName(1), 'connected');
  assert.equal(connectionStateName(2), 'connecting');
  assert.equal(connectionStateName(3), 'disconnecting');
  assert.equal(connectionStateName(99), 'unknown');
});

test('buildLiveness returns a stable public heartbeat payload', () => {
  const report = buildLiveness({
    now: new Date('2026-05-13T10:00:00.000Z'),
    service: 'api',
    version: '1.2.3',
  });

  assert.equal(report.ok, true);
  assert.equal(report.service, 'api');
  assert.equal(report.version, '1.2.3');
  assert.equal(report.timestamp, '2026-05-13T10:00:00.000Z');
  assert.equal(typeof report.uptimeSeconds, 'number');
});

test('databaseStatus reports readiness from mongoose readyState', () => {
  assert.deepEqual(databaseStatus({ connection: { readyState: 1 } }), {
    ok: true,
    readyState: 1,
    state: 'connected',
  });

  assert.deepEqual(databaseStatus({ connection: { readyState: 0 } }), {
    ok: false,
    readyState: 0,
    state: 'disconnected',
  });
});

test('buildReadiness combines database and job readiness checks', () => {
  const ready = buildReadiness({
    mongooseInstance: { connection: { readyState: 1 } },
    env: { JOBS_ENABLED: 'false' },
    now: new Date('2026-05-13T10:00:00.000Z'),
  });

  assert.equal(ready.ok, true);
  assert.equal(ready.checks.lifecycle.ok, true);
  assert.equal(ready.checks.database.ok, true);
  assert.equal(ready.checks.jobs.enabled, false);
  assert.equal(readinessStatusCode(ready), 200);

  const notReady = buildReadiness({
    mongooseInstance: { connection: { readyState: 2 } },
  });
  assert.equal(notReady.ok, false);
  assert.equal(readinessStatusCode(notReady), 503);
});

test('buildReadiness reports shutdown state as not ready', () => {
  const report = buildReadiness({
    mongooseInstance: { connection: { readyState: 1 } },
    lifecycleState: { shuttingDown: true, reason: 'SIGTERM' },
  });

  assert.equal(report.ok, false);
  assert.equal(report.checks.lifecycle.ok, false);
  assert.equal(report.checks.lifecycle.reason, 'SIGTERM');
  assert.equal(readinessStatusCode(report), 503);
});
