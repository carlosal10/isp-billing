'use strict';

const DEFAULT_SLOW_REQUEST_MS = 1000;

function normalizePath(value = '') {
  return String(value || '/')
    .split('?')[0]
    .replace(/[a-f0-9]{24}/gi, ':objectId')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ':uuid')
    .replace(/\/\d+(?=\/|$)/g, '/:number')
    .replace(/\/pl\/[^/]+/g, '/pl/:token')
    .replace(/\/pay\/[^/]+/g, '/pay/:token') || '/';
}

function statusBucket(statusCode) {
  const code = Number(statusCode) || 0;
  if (code >= 500) return '5xx';
  if (code >= 400) return '4xx';
  if (code >= 300) return '3xx';
  if (code >= 200) return '2xx';
  return 'other';
}

function createRequestMetrics(options = {}) {
  const slowRequestMs = Number(options.slowRequestMs || DEFAULT_SLOW_REQUEST_MS);
  const startedAt = options.startedAt || new Date();
  const routes = new Map();
  const totals = {
    count: 0,
    errors: 0,
    slow: 0,
    durationMs: 0,
  };

  function routeKey(method, path) {
    return `${String(method || 'GET').toUpperCase()} ${normalizePath(path)}`;
  }

  function ensureRoute(method, path) {
    const key = routeKey(method, path);
    if (!routes.has(key)) {
      routes.set(key, {
        method: String(method || 'GET').toUpperCase(),
        path: normalizePath(path),
        count: 0,
        errors: 0,
        slow: 0,
        durationMs: 0,
        statuses: {},
      });
    }
    return routes.get(key);
  }

  function record(event = {}) {
    const durationMs = Math.max(0, Number(event.durationMs) || 0);
    const bucket = statusBucket(event.statusCode);
    const failed = bucket === '4xx' || bucket === '5xx';
    const slow = durationMs >= slowRequestMs;
    const route = ensureRoute(event.method, event.path);

    route.count += 1;
    route.durationMs += durationMs;
    route.statuses[bucket] = (route.statuses[bucket] || 0) + 1;
    if (failed) route.errors += 1;
    if (slow) route.slow += 1;

    totals.count += 1;
    totals.durationMs += durationMs;
    if (failed) totals.errors += 1;
    if (slow) totals.slow += 1;

    return route;
  }

  function snapshot() {
    const routeRows = [...routes.values()]
      .sort((left, right) => right.count - left.count || left.path.localeCompare(right.path))
      .map((route) => ({
        ...route,
        avgDurationMs: route.count ? Math.round(route.durationMs / route.count) : 0,
      }));

    return {
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
      totals: {
        ...totals,
        avgDurationMs: totals.count ? Math.round(totals.durationMs / totals.count) : 0,
      },
      routes: routeRows,
    };
  }

  function reset() {
    routes.clear();
    totals.count = 0;
    totals.errors = 0;
    totals.slow = 0;
    totals.durationMs = 0;
  }

  return {
    record,
    reset,
    snapshot,
  };
}

const requestMetrics = createRequestMetrics();

function prometheusEscape(value = '') {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function renderPrometheusMetrics(snapshot, options = {}) {
  const service = prometheusEscape(options.service || 'isp-billing-api');
  const lines = [
    '# HELP isp_billing_http_requests_total Total HTTP requests observed by the API process.',
    '# TYPE isp_billing_http_requests_total counter',
    `isp_billing_http_requests_total{service="${service}"} ${snapshot.totals.count}`,
    '# HELP isp_billing_http_request_errors_total Total 4xx and 5xx HTTP responses.',
    '# TYPE isp_billing_http_request_errors_total counter',
    `isp_billing_http_request_errors_total{service="${service}"} ${snapshot.totals.errors}`,
    '# HELP isp_billing_http_request_slow_total Total requests slower than the configured threshold.',
    '# TYPE isp_billing_http_request_slow_total counter',
    `isp_billing_http_request_slow_total{service="${service}"} ${snapshot.totals.slow}`,
    '# HELP isp_billing_http_request_duration_ms_total Sum of request durations in milliseconds.',
    '# TYPE isp_billing_http_request_duration_ms_total counter',
    `isp_billing_http_request_duration_ms_total{service="${service}"} ${snapshot.totals.durationMs}`,
  ];

  snapshot.routes.forEach((route) => {
    const labels = `service="${service}",method="${prometheusEscape(route.method)}",path="${prometheusEscape(route.path)}"`;
    lines.push(`isp_billing_http_route_requests_total{${labels}} ${route.count}`);
    lines.push(`isp_billing_http_route_errors_total{${labels}} ${route.errors}`);
    lines.push(`isp_billing_http_route_duration_ms_total{${labels}} ${route.durationMs}`);
  });

  return `${lines.join('\n')}\n`;
}

module.exports = {
  DEFAULT_SLOW_REQUEST_MS,
  createRequestMetrics,
  normalizePath,
  renderPrometheusMetrics,
  requestMetrics,
  statusBucket,
};
