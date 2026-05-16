'use strict';

const { requestMetrics } = require('../services/requestMetricsService');

function requestMetricsMiddleware(metrics = requestMetrics) {
  return (req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      metrics.record({
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });
    next();
  };
}

function metricsTokenAllowed(req, env = process.env) {
  const expected = String(env.METRICS_TOKEN || '').trim();
  if (!expected && env.NODE_ENV !== 'production') return true;
  if (!expected) return false;

  const bearer = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const header = String(req.headers?.['x-metrics-token'] || '').trim();
  return bearer === expected || header === expected;
}

function requireMetricsAccess(env = process.env) {
  return (req, res, next) => {
    if (metricsTokenAllowed(req, env)) return next();
    return res.status(404).json({ ok: false, error: 'Not found', requestId: req.id || null });
  };
}

module.exports = {
  metricsTokenAllowed,
  requestMetricsMiddleware,
  requireMetricsAccess,
};
