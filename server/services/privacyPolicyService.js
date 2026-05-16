'use strict';

const RETENTION_CONTROLS = Object.freeze([
  {
    key: 'auditLogs',
    label: 'Audit logs',
    env: 'AUDIT_LOG_RETENTION_DAYS',
    defaultDays: 365,
    minDays: 30,
    maxDays: 2555,
    purpose: 'Security investigations, support traceability, and regulated operational review.',
  },
  {
    key: 'messageDeliveries',
    label: 'Message deliveries',
    env: 'MESSAGE_DELIVERY_RETENTION_DAYS',
    defaultDays: 365,
    minDays: 30,
    maxDays: 1095,
    purpose: 'Customer notification proof, SMS troubleshooting, and campaign delivery analytics.',
  },
  {
    key: 'paymentGatewayEvents',
    label: 'Payment gateway events',
    env: 'PAYMENT_GATEWAY_EVENT_RETENTION_DAYS',
    defaultDays: 730,
    minDays: 90,
    maxDays: 2555,
    purpose: 'Payment dispute handling, reconciliation, chargeback review, and provider callback audits.',
  },
  {
    key: 'platformGatewayEventActions',
    label: 'Platform gateway event actions',
    env: 'PLATFORM_GATEWAY_EVENT_ACTION_RETENTION_DAYS',
    defaultDays: 730,
    minDays: 90,
    maxDays: 2555,
    purpose: 'Platform orphan-queue action history and operational accountability.',
  },
  {
    key: 'schedulerRuns',
    label: 'Scheduler runs',
    env: 'JOB_RUN_RETENTION_DAYS',
    defaultDays: 90,
    minDays: 7,
    maxDays: 365,
    purpose: 'Operational reliability analysis and failed-job troubleshooting.',
  },
  {
    key: 'schedulerActions',
    label: 'Scheduler actions',
    env: 'JOB_ACTION_RETENTION_DAYS',
    defaultDays: 180,
    minDays: 30,
    maxDays: 730,
    purpose: 'Administrative scheduler-control auditability.',
  },
]);

function parsePositiveInteger(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return NaN;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : NaN;
}

function evaluateRetentionControl(control, env = {}) {
  const raw = env[control.env];
  const configured = parsePositiveInteger(raw);
  const hasConfiguredValue = raw != null && String(raw).trim() !== '';
  const days = hasConfiguredValue ? configured : control.defaultDays;
  const errors = [];
  const warnings = [];

  if (Number.isNaN(days)) {
    errors.push(`${control.env} must be a positive integer number of days.`);
  } else {
    if (days < control.minDays) {
      errors.push(`${control.env}=${days} is below the minimum ${control.minDays} days.`);
    }
    if (days > control.maxDays) {
      errors.push(`${control.env}=${days} exceeds the maximum ${control.maxDays} days.`);
    }
    if (!hasConfiguredValue) {
      warnings.push(`${control.env} is not set; using the default ${control.defaultDays} days.`);
    }
  }

  return {
    ...control,
    days: Number.isNaN(days) ? null : days,
    source: hasConfiguredValue ? 'env' : 'default',
    errors,
    warnings,
  };
}

function buildPrivacyPolicyReport(env = process.env) {
  const retention = RETENTION_CONTROLS.map((control) => evaluateRetentionControl(control, env));
  const errors = retention.flatMap((item) => item.errors.map((message) => ({ key: item.env, message })));
  const warnings = retention.flatMap((item) => item.warnings.map((message) => ({ key: item.env, message })));

  return {
    ok: errors.length === 0,
    generatedAt: new Date().toISOString(),
    retention,
    errors,
    warnings,
  };
}

function formatPrivacyPolicyReport(report = buildPrivacyPolicyReport()) {
  const lines = ['[privacy] retention policy'];

  report.retention.forEach((item) => {
    const days = item.days == null ? 'invalid' : `${item.days} days`;
    lines.push(`- ${item.label}: ${days} (${item.source}; ${item.env})`);
  });

  if (report.warnings.length) {
    lines.push('[privacy] warnings');
    report.warnings.forEach((warning) => lines.push(`- ${warning.key}: ${warning.message}`));
  }

  if (report.errors.length) {
    lines.push('[privacy] errors');
    report.errors.forEach((error) => lines.push(`- ${error.key}: ${error.message}`));
  }

  lines.push(report.ok ? '[privacy] ok' : '[privacy] failed');
  return lines.join('\n');
}

module.exports = {
  RETENTION_CONTROLS,
  buildPrivacyPolicyReport,
  evaluateRetentionControl,
  formatPrivacyPolicyReport,
  parsePositiveInteger,
};
