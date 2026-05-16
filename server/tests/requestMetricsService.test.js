'use strict';

const assert = require('assert');
const test = require('node:test');

const {
  createRequestMetrics,
  normalizePath,
  renderPrometheusMetrics,
  statusBucket,
} = require('../services/requestMetricsService');
const { metricsTokenAllowed } = require('../middleware/requestMetrics');

test('normalizePath limits high-cardinality request labels', () => {
  assert.equal(normalizePath('/api/customers/507f1f77bcf86cd799439011?x=1'), '/api/customers/:objectId');
  assert.equal(normalizePath('/api/jobs/123/runs'), '/api/jobs/:number/runs');
  assert.equal(normalizePath('/pl/super-secret-token'), '/pl/:token');
});

test('statusBucket groups HTTP statuses', () => {
  assert.equal(statusBucket(200), '2xx');
  assert.equal(statusBucket(302), '3xx');
  assert.equal(statusBucket(404), '4xx');
  assert.equal(statusBucket(500), '5xx');
  assert.equal(statusBucket(99), 'other');
});

test('request metrics records totals, errors, slow requests, and route averages', () => {
  const metrics = createRequestMetrics({
    slowRequestMs: 100,
    startedAt: new Date('2026-05-13T10:00:00.000Z'),
  });

  metrics.record({ method: 'GET', path: '/api/customers/1', statusCode: 200, durationMs: 50 });
  metrics.record({ method: 'GET', path: '/api/customers/2', statusCode: 500, durationMs: 150 });

  const snapshot = metrics.snapshot();
  assert.equal(snapshot.totals.count, 2);
  assert.equal(snapshot.totals.errors, 1);
  assert.equal(snapshot.totals.slow, 1);
  assert.equal(snapshot.routes[0].path, '/api/customers/:number');
  assert.equal(snapshot.routes[0].avgDurationMs, 100);
});

test('renderPrometheusMetrics emits safe text exposition', () => {
  const metrics = createRequestMetrics();
  metrics.record({ method: 'POST', path: '/api/payments', statusCode: 201, durationMs: 25 });

  const text = renderPrometheusMetrics(metrics.snapshot(), { service: 'isp "billing"' });

  assert.match(text, /isp_billing_http_requests_total\{service="isp \\"billing\\""\} 1/);
  assert.match(text, /isp_billing_http_route_requests_total\{service="isp \\"billing\\"",method="POST",path="\/api\/payments"\} 1/);
});

test('metricsTokenAllowed requires token in production and allows dev without one', () => {
  assert.equal(metricsTokenAllowed({ headers: {} }, { NODE_ENV: 'development' }), true);
  assert.equal(metricsTokenAllowed({ headers: {} }, { NODE_ENV: 'production' }), false);
  assert.equal(
    metricsTokenAllowed({ headers: { authorization: 'Bearer secret-token' } }, { NODE_ENV: 'production', METRICS_TOKEN: 'secret-token' }),
    true
  );
  assert.equal(
    metricsTokenAllowed({ headers: { 'x-metrics-token': 'secret-token' } }, { NODE_ENV: 'production', METRICS_TOKEN: 'secret-token' }),
    true
  );
});
