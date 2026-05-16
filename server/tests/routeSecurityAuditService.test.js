'use strict';

const assert = require('assert');
const test = require('node:test');

const {
  auditAppRouteSecurity,
  auditRouteModulePolicies,
  detectMountGuards,
  extractAppRouteMounts,
  inferredAccess,
} = require('../services/routeSecurityAuditService');

test('extractAppRouteMounts captures mounted literal routes and guards', () => {
  const mounts = extractAppRouteMounts(`
app.get("/health", handler);
app.use("/api/customers", authenticate, attachTenant, customerRoutes);
app.use(express.json());
`);

  assert.equal(mounts.length, 2);
  assert.equal(mounts[0].key, 'GET /health');
  assert.equal(mounts[1].key, 'USE /api/customers');
  assert.equal(mounts[1].guards.authenticate, true);
  assert.equal(mounts[1].guards.attachTenant, true);
});

test('detectMountGuards and inferredAccess classify app-level protection', () => {
  const tenant = { guards: detectMountGuards('app.use("/api", authenticate, attachTenant, routes)') };
  const platform = { guards: detectMountGuards('app.use("/platform-api", requirePlatformAdmin, routes)') };
  const user = { guards: detectMountGuards('app.use("/api/account", authenticate, routes)') };

  assert.equal(inferredAccess(tenant), 'tenant-auth');
  assert.equal(inferredAccess(platform), 'platform-admin');
  assert.equal(inferredAccess(user), 'user-auth');
});

test('auditAppRouteSecurity fails unclassified public-looking mounts', () => {
  const report = auditAppRouteSecurity(`
app.get("/health", handler);
app.use("/api/new-public", newRoutes);
app.get("/metrics", requireMetricsAccess(), handler);
`);

  assert.equal(report.ok, false);
  assert.deepEqual(report.unclassified.map((item) => item.key), ['USE /api/new-public']);
});

test('auditAppRouteSecurity detects missing required guards for policy routes', () => {
  const report = auditAppRouteSecurity(`
app.get("/metrics", handler);
`);

  assert.equal(report.ok, false);
  assert.deepEqual(report.guardMismatches.map((item) => item.key), ['GET /metrics']);
  assert.deepEqual(report.guardMismatches[0].missingGuards, ['requireMetricsAccess']);
});

test('auditRouteModulePolicies checks expected guard snippets', () => {
  const report = auditRouteModulePolicies({
    'server/routes/integrationApi.js': 'router.use(apiKeyAuth);\nrouter.get("/v1/customers", requireApiKeyScope("customers:read"), handler);',
  }, [
    {
      file: 'server/routes/integrationApi.js',
      requiredSnippets: ['router.use(apiKeyAuth)', 'requireApiKeyScope'],
      reason: 'Integration API must be scoped.',
    },
  ]);

  assert.equal(report.ok, true);

  const failed = auditRouteModulePolicies({ 'server/routes/finance.js': '' }, [
    {
      file: 'server/routes/finance.js',
      requiredSnippets: ["requireRole('owner', 'admin')"],
      reason: 'Finance must be guarded.',
    },
  ]);
  assert.equal(failed.ok, false);
  assert.equal(failed.missing[0].file, 'server/routes/finance.js');
});
