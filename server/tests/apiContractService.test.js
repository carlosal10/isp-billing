'use strict';

const assert = require('assert');
const test = require('node:test');

const {
  auditApiContract,
  expressPathToOpenApiPath,
  extractExpressMounts,
  isDocumentedMount,
  parseOpenApiPaths,
  runtimePathToContractPath,
  validateOpenApiShape,
} = require('../services/apiContractService');

test('parseOpenApiPaths extracts paths and detects duplicates', () => {
  const parsed = parseOpenApiPaths(`
openapi: 3.0.3
paths:
  /customers:
    get: {}
  /customers:
    post: {}
`);

  assert.deepEqual(parsed.paths, ['/customers', '/customers']);
  assert.deepEqual(parsed.duplicates, [{ path: '/customers', count: 2 }]);
});

test('extractExpressMounts captures literal Express mount paths', () => {
  const mounts = extractExpressMounts(`
app.use("/api/customers", customerRoutes);
app.get('/ready', handler);
app.use(express.json());
`);

  assert.deepEqual(mounts, [
    { method: 'USE', runtimePath: '/api/customers', contractPath: '/customers' },
    { method: 'GET', runtimePath: '/ready', contractPath: '/ready' },
  ]);
});

test('runtimePathToContractPath strips only the API base prefix', () => {
  assert.equal(runtimePathToContractPath('/api/invoices'), '/invoices');
  assert.equal(runtimePathToContractPath('/platform-api/auth'), '/platform-api/auth');
  assert.equal(runtimePathToContractPath('/portal-api'), '/portal-api');
});

test('expressPathToOpenApiPath converts Express parameters', () => {
  assert.equal(expressPathToOpenApiPath('/payments/:id/refund'), '/payments/{id}/refund');
});

test('isDocumentedMount accepts exact endpoints and documented route prefixes', () => {
  assert.equal(
    isDocumentedMount({ method: 'GET', contractPath: '/ready' }, ['/ready']),
    true
  );
  assert.equal(
    isDocumentedMount({ method: 'USE', contractPath: '/payments' }, ['/payments/manual']),
    true
  );
  assert.equal(
    isDocumentedMount({ method: 'GET', contractPath: '/payments' }, ['/payments/manual']),
    false
  );
});

test('validateOpenApiShape enforces OpenAPI version and paths section', () => {
  assert.deepEqual(validateOpenApiShape('openapi: 3.0.3\npaths:\n'), []);
  assert.deepEqual(validateOpenApiShape('info:\n  title: Missing\n'), [
    'OpenAPI document must declare openapi: 3.x.',
    'OpenAPI document must include a top-level paths section.',
  ]);
});

test('auditApiContract fails only undocumented non-exempt mounts', () => {
  const report = auditApiContract({
    openApiText: `
openapi: 3.0.3
paths:
  /customers:
    get: {}
`,
    appSource: `
app.use("/api/customers", customerRoutes);
app.use("/api/debug", debugRoutes);
app.use("/api/new-surface", newRoutes);
`,
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.documented.map((item) => item.contractPath), ['/customers']);
  assert.deepEqual(report.exempt.map((item) => item.contractPath), ['/debug']);
  assert.deepEqual(report.missing.map((item) => item.contractPath), ['/new-surface']);
});
