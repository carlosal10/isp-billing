'use strict';

const ROUTE_SECURITY_POLICIES = Object.freeze({
  'GET /api/health': { access: 'public-liveness', reason: 'Public health probe.' },
  'GET /health': { access: 'public-liveness', reason: 'Public health probe.' },
  'GET /ready': { access: 'public-readiness', reason: 'Public readiness probe for deployment platforms.' },
  'GET /api/docs/openapi.yaml': { access: 'public-docs', reason: 'Serves public API contract.' },
  'GET /pl/:token': { access: 'public-redirect', reason: 'Short paylink redirect only.' },
  'GET /metrics': {
    access: 'metrics-token',
    requiredGuards: ['requireMetricsAccess'],
    reason: 'Metrics endpoint must be hidden unless a metrics token is accepted.',
  },
  'USE /api/auth': { access: 'public-auth', reason: 'Tenant login/register surface.' },
  'USE /api/invites': {
    access: 'route-managed-auth',
    reason: 'Invite accept is public; list/create/revoke are guarded inside invites route.',
  },
  'USE /platform-api/auth': { access: 'public-platform-auth', reason: 'Platform admin login surface.' },
  'USE /portal-api/auth': { access: 'route-managed-portal-auth', reason: 'Portal login is public; verify is guarded inside route.' },
  'USE /portal-api': {
    access: 'route-managed-portal-auth',
    reason: 'Customer portal API is guarded by requirePortalAuth inside the route module.',
  },
  'USE /api/paylink': { access: 'public-paylink', reason: 'Public customer payment starter.' },
  'USE /api/payment/callback': { access: 'provider-callback', reason: 'M-Pesa callback compatibility path.' },
  'USE /api/payments/callback': { access: 'provider-callback', reason: 'M-Pesa callback canonical path.' },
  'USE /api/payment/stripe': { access: 'provider-callback', reason: 'Stripe webhook receiver.' },
  'USE /api/mpesa/c2b': { access: 'provider-callback', reason: 'M-Pesa C2B webhook receiver.' },
  'USE /api/integration': {
    access: 'api-key-auth',
    reason: 'Integration API is guarded by API key middleware inside the route module.',
  },
});

const ROUTE_MODULE_POLICIES = Object.freeze([
  {
    file: 'server/routes/apiKeys.js',
    requiredSnippets: ["router.use(requireRole('owner', 'admin'))"],
    reason: 'API key management must be owner/admin only.',
  },
  {
    file: 'server/routes/auditLogs.js',
    requiredSnippets: ["router.use(requireRole('owner', 'admin'))"],
    reason: 'Audit logs must be owner/admin only.',
  },
  {
    file: 'server/routes/customerPortal.js',
    requiredSnippets: ['router.use(requirePortalAuth)'],
    reason: 'Customer portal data routes require portal authentication.',
  },
  {
    file: 'server/routes/finance.js',
    requiredSnippets: ["requireRole('owner', 'admin')"],
    reason: 'Finance reports must be owner/admin only.',
  },
  {
    file: 'server/routes/integrationApi.js',
    requiredSnippets: ['router.use(apiKeyAuth)', 'requireApiKeyScope'],
    reason: 'Integration API requires API key authentication and scoped access.',
  },
  {
    file: 'server/routes/invites.js',
    requiredSnippets: ['protectedTenantAccess', 'requireRole("owner", "admin")'],
    reason: 'Invite management must be authenticated and owner/admin only.',
  },
  {
    file: 'server/routes/Invoices.js',
    requiredSnippets: ["requireRole('owner', 'admin')"],
    reason: 'Invoice mutation endpoints must be owner/admin only.',
  },
  {
    file: 'server/routes/jobs.js',
    requiredSnippets: ["requireRole('owner', 'admin')"],
    reason: 'Scheduler controls must be owner/admin only.',
  },
  {
    file: 'server/routes/nocOperations.js',
    requiredSnippets: ["requireRole('owner', 'admin')"],
    reason: 'NOC incident operations must be owner/admin only.',
  },
  {
    file: 'server/routes/opsHealth.js',
    requiredSnippets: ["requireRole('owner', 'admin')"],
    reason: 'Operational health rollups must be owner/admin only.',
  },
  {
    file: 'server/routes/payment.js',
    requiredSnippets: ["requireRole('owner', 'admin')"],
    reason: 'Payment reversals, retries, and settlement mutations must be owner/admin only.',
  },
  {
    file: 'server/routes/platformGatewayEvents.js',
    requiredSnippets: ['platformActor(req)'],
    reason: 'Platform gateway-event actions must keep platform actor attribution.',
  },
  {
    file: 'server/routes/serviceOperations.js',
    requiredSnippets: ["requireRole('owner', 'admin')"],
    reason: 'Inventory/IPAM operations must be owner/admin only.',
  },
  {
    file: 'server/routes/sms.js',
    requiredSnippets: ["requireRole('owner', 'admin')"],
    reason: 'SMS campaigns must be owner/admin only.',
  },
  {
    file: 'server/routes/supportOperations.js',
    requiredSnippets: ["requireRole('owner', 'admin')"],
    reason: 'Support and work-order operations must be owner/admin only.',
  },
]);

function normalizePath(value = '') {
  const raw = String(value || '').trim();
  if (!raw || raw === '/') return '/';
  return raw.replace(/\/+$/, '') || '/';
}

function findCallEnd(source, startIndex) {
  const end = source.indexOf('\n);', startIndex);
  if (end !== -1) return end + 3;
  const inlineEnd = source.indexOf(');', startIndex);
  return inlineEnd === -1 ? source.length : inlineEnd + 2;
}

function extractAppRouteMounts(appSource = '') {
  const mounts = [];
  const pattern = /app\.(get|post|put|patch|delete|use)\(\s*["']([^"']+)["']/g;
  let match;
  while ((match = pattern.exec(appSource)) !== null) {
    const startIndex = match.index;
    const callText = appSource.slice(startIndex, findCallEnd(appSource, startIndex));
    mounts.push({
      method: match[1].toUpperCase(),
      path: normalizePath(match[2]),
      key: `${match[1].toUpperCase()} ${normalizePath(match[2])}`,
      callText,
      guards: detectMountGuards(callText),
    });
  }
  return mounts;
}

function detectMountGuards(callText = '') {
  return {
    authenticate: /\bauthenticate\b/.test(callText),
    attachTenant: /\battachTenant\b/.test(callText),
    requirePlatformAdmin: /\brequirePlatformAdmin\b/.test(callText),
    requireMetricsAccess: /\brequireMetricsAccess\b/.test(callText),
  };
}

function inferredAccess(mount) {
  if (mount.guards.requirePlatformAdmin) return 'platform-admin';
  if (mount.guards.authenticate && mount.guards.attachTenant) return 'tenant-auth';
  if (mount.guards.authenticate) return 'user-auth';
  if (mount.guards.requireMetricsAccess) return 'metrics-token';
  return null;
}

function missingRequiredGuards(mount, policy = {}) {
  return (policy.requiredGuards || []).filter((guard) => !mount.guards[guard]);
}

function auditAppRouteSecurity(appSource = '', policies = ROUTE_SECURITY_POLICIES) {
  const mounts = extractAppRouteMounts(appSource);
  const classified = [];
  const unclassified = [];
  const guardMismatches = [];

  mounts.forEach((mount) => {
    const policy = policies[mount.key] || null;
    const inferred = inferredAccess(mount);
    const missingGuards = missingRequiredGuards(mount, policy || {});
    if (missingGuards.length) {
      guardMismatches.push({ ...mount, policy, missingGuards });
    }

    if (policy || inferred) {
      classified.push({
        ...mount,
        access: policy?.access || inferred,
        reason: policy?.reason || 'Authenticated by app-level middleware.',
      });
      return;
    }

    unclassified.push(mount);
  });

  return {
    ok: unclassified.length === 0 && guardMismatches.length === 0,
    mounts,
    classified,
    unclassified,
    guardMismatches,
  };
}

function auditRouteModulePolicies(fileTextByPath = {}, policies = ROUTE_MODULE_POLICIES) {
  const missing = [];

  policies.forEach((policy) => {
    const text = fileTextByPath[policy.file] || '';
    const missingSnippets = policy.requiredSnippets.filter((snippet) => !text.includes(snippet));
    if (missingSnippets.length) {
      missing.push({
        file: policy.file,
        reason: policy.reason,
        missingSnippets,
      });
    }
  });

  return {
    ok: missing.length === 0,
    checked: policies.length,
    missing,
  };
}

function auditRouteSecurity({ appSource = '', fileTextByPath = {} } = {}) {
  const app = auditAppRouteSecurity(appSource);
  const modules = auditRouteModulePolicies(fileTextByPath);
  return {
    ok: app.ok && modules.ok,
    app,
    modules,
  };
}

module.exports = {
  ROUTE_MODULE_POLICIES,
  ROUTE_SECURITY_POLICIES,
  auditAppRouteSecurity,
  auditRouteModulePolicies,
  auditRouteSecurity,
  detectMountGuards,
  extractAppRouteMounts,
  inferredAccess,
  missingRequiredGuards,
  normalizePath,
};
