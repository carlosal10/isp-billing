'use strict';

const CONTRACT_EXEMPTIONS = Object.freeze({
  '/api': 'Generic API mount; mounted route modules are audited through their documented concrete paths.',
  '/docs/openapi.yaml': 'Serves the OpenAPI document itself.',
  '/pl/:token': 'Short public redirect alias for documented paylink flows.',
  '/auth': 'Tenant auth surface is intentionally excluded until auth contract redaction is completed.',
  '/platform-api/auth': 'Platform auth surface is intentionally excluded until auth contract redaction is completed.',
  '/payment/callback': 'Provider callback compatibility alias; canonical callback docs live under payments.',
  '/payment/stripe': 'Provider webhook endpoint; documented separately in provider operations runbooks.',
  '/mpesa/c2b': 'Provider webhook endpoint; documented separately in provider operations runbooks.',
  '/flags': 'Internal feature flag endpoint.',
  '/usageLogs': 'Legacy operational endpoint awaiting route consolidation.',
  '/stats': 'Legacy dashboard endpoint awaiting route consolidation.',
  '/tenant': 'Tenant settings endpoint awaiting route consolidation.',
  '/account': 'Account endpoint awaiting route consolidation.',
  '/queues': 'Router operations endpoint awaiting network API contract consolidation.',
  '/arp': 'Router operations endpoint awaiting network API contract consolidation.',
  '/pppoe': 'Router operations endpoint awaiting network API contract consolidation.',
  '/static-candidates': 'Router operations endpoint awaiting network API contract consolidation.',
  '/connect': 'Router connection endpoint awaiting network API contract consolidation.',
  '/mikrotik/terminal': 'Interactive terminal endpoint governed by command policy rather than OpenAPI.',
  '/mikrotik/admin': 'Router admin endpoint awaiting network API contract consolidation.',
  '/static': 'Static IP router endpoint awaiting network API contract consolidation.',
  '/hotspot-plans': 'Hotspot endpoint awaiting network API contract consolidation.',
  '/hotspot': 'Hotspot endpoint awaiting network API contract consolidation.',
  '/payment-config': 'Payment settings endpoint awaiting finance admin contract consolidation.',
  '/mpesa-settings': 'Payment settings endpoint awaiting finance admin contract consolidation.',
  '/paylink/admin': 'Admin paylink helper endpoint awaiting finance admin contract consolidation.',
  '/debug': 'Debug endpoint intentionally excluded from public contract.',
});

function normalizePath(value = '') {
  const raw = String(value || '').trim();
  if (!raw || raw === '/') return '/';
  return raw.replace(/\/+$/, '') || '/';
}

function runtimePathToContractPath(runtimePath) {
  const normalized = normalizePath(runtimePath);
  if (normalized === '/api') return '/api';
  if (normalized.startsWith('/api/')) return normalizePath(normalized.slice(4));
  return normalized;
}

function expressPathToOpenApiPath(expressPath) {
  return normalizePath(expressPath).replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
}

function parseOpenApiPaths(openApiText = '') {
  const paths = [];
  const counts = new Map();
  const pattern = /^  (\/[^:\s]+):\s*$/gm;
  let match;
  while ((match = pattern.exec(openApiText)) !== null) {
    const path = normalizePath(match[1]);
    paths.push(path);
    counts.set(path, (counts.get(path) || 0) + 1);
  }

  return {
    paths,
    duplicates: [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([path, count]) => ({ path, count })),
  };
}

function extractExpressMounts(appSource = '') {
  const mounts = [];
  const pattern = /app\.(get|post|put|patch|delete|use)\(\s*["']([^"']+)["']/g;
  let match;
  while ((match = pattern.exec(appSource)) !== null) {
    mounts.push({
      method: match[1].toUpperCase(),
      runtimePath: normalizePath(match[2]),
      contractPath: runtimePathToContractPath(match[2]),
    });
  }
  return mounts;
}

function isDocumentedMount(mount, documentedPaths = []) {
  const contractPath = expressPathToOpenApiPath(mount.contractPath);
  if (documentedPaths.includes(contractPath)) return true;
  if (mount.method !== 'USE') return false;

  const prefix = contractPath.endsWith('/') ? contractPath : `${contractPath}/`;
  return documentedPaths.some((path) => path.startsWith(prefix));
}

function validateOpenApiShape(openApiText = '') {
  const errors = [];
  if (!/^openapi:\s*3\./m.test(openApiText)) {
    errors.push('OpenAPI document must declare openapi: 3.x.');
  }
  if (!/^paths:\s*$/m.test(openApiText)) {
    errors.push('OpenAPI document must include a top-level paths section.');
  }
  return errors;
}

function auditApiContract({ openApiText = '', appSource = '', exemptions = CONTRACT_EXEMPTIONS } = {}) {
  const shapeErrors = validateOpenApiShape(openApiText);
  const parsed = parseOpenApiPaths(openApiText);
  const mounts = extractExpressMounts(appSource);
  const documented = [];
  const exempt = [];
  const missing = [];

  mounts.forEach((mount) => {
    if (isDocumentedMount(mount, parsed.paths)) {
      documented.push(mount);
      return;
    }

    const reason = exemptions[mount.contractPath];
    if (reason) {
      exempt.push({ ...mount, reason });
      return;
    }

    missing.push(mount);
  });

  return {
    ok: shapeErrors.length === 0 && parsed.duplicates.length === 0 && missing.length === 0,
    shapeErrors,
    duplicatePaths: parsed.duplicates,
    documentedPaths: parsed.paths,
    mounts,
    documented,
    exempt,
    missing,
  };
}

module.exports = {
  CONTRACT_EXEMPTIONS,
  auditApiContract,
  expressPathToOpenApiPath,
  extractExpressMounts,
  isDocumentedMount,
  normalizePath,
  parseOpenApiPaths,
  runtimePathToContractPath,
  validateOpenApiShape,
};
