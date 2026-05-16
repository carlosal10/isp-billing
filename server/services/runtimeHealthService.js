'use strict';

const mongoose = require('mongoose');

const MONGOOSE_STATES = Object.freeze({
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
});

function connectionStateName(readyState) {
  return MONGOOSE_STATES[readyState] || 'unknown';
}

function buildLiveness(options = {}) {
  return {
    ok: true,
    service: options.service || 'isp-billing-api',
    version: options.version || process.env.npm_package_version || '0.1.0',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: (options.now || new Date()).toISOString(),
  };
}

function databaseStatus(mongooseInstance = mongoose) {
  const readyState = mongooseInstance?.connection?.readyState;
  return {
    ok: readyState === 1,
    readyState,
    state: connectionStateName(readyState),
  };
}

function buildReadiness(options = {}) {
  const db = databaseStatus(options.mongooseInstance || mongoose);
  const shuttingDown = Boolean(options.lifecycleState?.shuttingDown);
  const jobsEnabled = String((options.env || process.env).JOBS_ENABLED || 'true').toLowerCase() !== 'false';
  const checks = {
    lifecycle: {
      ok: !shuttingDown,
      shuttingDown,
      reason: options.lifecycleState?.reason || null,
    },
    database: db,
    jobs: {
      ok: true,
      enabled: jobsEnabled,
    },
  };

  return {
    ok: Object.values(checks).every((check) => check.ok === true),
    service: options.service || 'isp-billing-api',
    version: options.version || process.env.npm_package_version || '0.1.0',
    checks,
    timestamp: (options.now || new Date()).toISOString(),
  };
}

function readinessStatusCode(report) {
  return report?.ok ? 200 : 503;
}

module.exports = {
  buildLiveness,
  buildReadiness,
  connectionStateName,
  databaseStatus,
  readinessStatusCode,
};
