'use strict';

const mongoose = require('mongoose');
const Customer = require('../models/customers');
const Invoice = require('../models/Invoice');
const JobRun = require('../models/JobRun');
const MessageDelivery = require('../models/MessageDelivery');
const NocIncident = require('../models/NocIncident');
const PaymentConfig = require('../models/PaymentConfig');
const PaymentGatewayEvent = require('../models/PaymentGatewayEvent');
const SmsSettings = require('../models/SmsSettings');
const SupportTicket = require('../models/SupportTicket');
const { getStatus: getRouterStatus } = require('../utils/mikrotikConnectionManager');
const { listScheduledJobs } = require('../utils/scheduler');

const DAY_MS = 24 * 60 * 60 * 1000;
const SEVERITY_WEIGHT = {
  critical: 25,
  warning: 10,
  info: 0,
};

function since(days = 1) {
  return new Date(Date.now() - Number(days || 1) * DAY_MS);
}

function severityRank(severity) {
  if (severity === 'critical') return 3;
  if (severity === 'warning') return 2;
  if (severity === 'info') return 1;
  return 0;
}

function makeIssue({ severity = 'info', code, title, detail, action, module, metric = null }) {
  return {
    severity,
    code,
    title,
    detail,
    action,
    module,
    metric,
  };
}

function calculateHealthScore(issues = []) {
  const penalty = issues.reduce((sum, issue) => {
    return sum + (SEVERITY_WEIGHT[issue.severity] || 0);
  }, 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

function healthLabel(score) {
  if (score >= 90) return 'healthy';
  if (score >= 70) return 'watch';
  if (score >= 45) return 'degraded';
  return 'critical';
}

function countBySeverity(issues = []) {
  return issues.reduce(
    (acc, issue) => {
      if (issue.severity === 'critical') acc.critical += 1;
      else if (issue.severity === 'warning') acc.warning += 1;
      else acc.info += 1;
      return acc;
    },
    { critical: 0, warning: 0, info: 0 }
  );
}

function tenantMatchValue(tenantId) {
  return mongoose.isValidObjectId(tenantId)
    ? new mongoose.Types.ObjectId(String(tenantId))
    : tenantId;
}

function moduleStatusFromIssues(issues = []) {
  if (issues.some((issue) => issue.severity === 'critical')) return 'critical';
  if (issues.some((issue) => issue.severity === 'warning')) return 'watch';
  return 'healthy';
}

function summarizeRouters(tenantId, issues) {
  const routers = getRouterStatus().filter((router) => String(router.tenantId) === String(tenantId));
  const connected = routers.filter((router) => router.connected).length;
  const disconnected = routers.length - connected;
  const highQueue = routers.filter((router) => Number(router.queueLength || 0) >= 50).length;

  if (!routers.length) {
    issues.push(makeIssue({
      severity: 'warning',
      code: 'router.no_active_session',
      title: 'No active MikroTik pool session observed',
      detail: 'The app has no live router connection in the in-memory pool for this tenant.',
      action: 'Open Routers or run a lightweight router status check to verify connectivity.',
      module: 'network',
      metric: 0,
    }));
  } else if (disconnected > 0) {
    issues.push(makeIssue({
      severity: 'critical',
      code: 'router.disconnected',
      title: `${disconnected} router session(s) disconnected`,
      detail: 'One or more MikroTik pool entries are disconnected or recently failed health probes.',
      action: 'Inspect router credentials, reachability, and recent RouterOS command errors.',
      module: 'network',
      metric: disconnected,
    }));
  }

  if (highQueue > 0) {
    issues.push(makeIssue({
      severity: 'warning',
      code: 'router.queue_backlog',
      title: `${highQueue} router command queue(s) are backing up`,
      detail: 'Command queues above 50 can delay provisioning, disconnects, and health checks.',
      action: 'Check long-running jobs or slow RouterOS responses.',
      module: 'network',
      metric: highQueue,
    }));
  }

  return {
    key: 'network',
    label: 'Network Routers',
    status: routers.length && disconnected === 0 && highQueue === 0 ? 'healthy' : moduleStatusFromIssues(issues.filter((issue) => issue.module === 'network')),
    metrics: {
      totalRouters: routers.length,
      connected,
      disconnected,
      highQueue,
    },
    sample: routers.slice(0, 5).map((router) => ({
      host: router.host,
      connected: router.connected === true,
      fails: router.fails || 0,
      queueLength: router.queueLength || 0,
      lastOkAt: router.lastOkAt || null,
      lastErr: router.lastErr || null,
    })),
  };
}

async function summarizeJobs(tenantId, issues) {
  const scheduled = listScheduledJobs();
  const names = scheduled.map((job) => job.name);
  const recentFailures = await JobRun.find({
    ...(names.length ? { name: { $in: names } } : {}),
    ok: false,
    startedAt: { $gte: since(1) },
    $or: [
      { tenantId: String(tenantId) },
      { tenantId: null },
      { tenantId: { $exists: false } },
    ],
  })
    .sort({ startedAt: -1 })
    .limit(5)
    .lean();

  const stuckRuns = await JobRun.countDocuments({
    ok: { $exists: false },
    startedAt: { $lt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    $or: [
      { tenantId: String(tenantId) },
      { tenantId: null },
      { tenantId: { $exists: false } },
    ],
  });

  if (recentFailures.length >= 3) {
    issues.push(makeIssue({
      severity: 'critical',
      code: 'jobs.repeated_failures',
      title: `${recentFailures.length} failed job run(s) in the last 24 hours`,
      detail: 'Repeated scheduler failures can break billing, gateway retries, suspension, or sync tasks.',
      action: 'Open Jobs and inspect the latest failed run error details.',
      module: 'jobs',
      metric: recentFailures.length,
    }));
  } else if (recentFailures.length > 0) {
    issues.push(makeIssue({
      severity: 'warning',
      code: 'jobs.recent_failure',
      title: `${recentFailures.length} failed job run(s) in the last 24 hours`,
      detail: 'At least one scheduler job failed recently.',
      action: 'Review the failed run and decide whether to rerun it manually.',
      module: 'jobs',
      metric: recentFailures.length,
    }));
  }

  if (stuckRuns > 0) {
    issues.push(makeIssue({
      severity: 'warning',
      code: 'jobs.stuck_runs',
      title: `${stuckRuns} job run(s) look unfinished`,
      detail: 'A job started more than two hours ago without a terminal result.',
      action: 'Check process logs and job locks before running it again.',
      module: 'jobs',
      metric: stuckRuns,
    }));
  }

  return {
    key: 'jobs',
    label: 'Scheduler Jobs',
    status: moduleStatusFromIssues(issues.filter((issue) => issue.module === 'jobs')),
    metrics: {
      registeredJobs: scheduled.length,
      failedLast24h: recentFailures.length,
      stuckRuns,
    },
    sample: recentFailures.map((run) => ({
      name: run.name,
      startedAt: run.startedAt,
      error: run.error || null,
      trigger: run.trigger || null,
    })),
  };
}

async function summarizeBilling(tenantId, issues) {
  const [overdueInvoices, outstandingAgg, expiringCustomers, expiredCustomers] = await Promise.all([
    Invoice.countDocuments({ tenantId, status: 'overdue', balanceDue: { $gt: 0 } }),
    Invoice.aggregate([
      { $match: { tenantId: tenantMatchValue(tenantId), status: { $in: ['issued', 'partially_paid', 'overdue'] } } },
      { $group: { _id: null, balanceDue: { $sum: '$balanceDue' } } },
    ]).catch(() => []),
    Customer.countDocuments({
      tenantId,
      expiryDate: {
        $gte: new Date(),
        $lte: new Date(Date.now() + 3 * DAY_MS),
      },
    }),
    Customer.countDocuments({
      tenantId,
      expiryDate: { $lt: new Date() },
    }),
  ]);

  if (overdueInvoices > 0) {
    issues.push(makeIssue({
      severity: overdueInvoices >= 25 ? 'critical' : 'warning',
      code: 'billing.overdue_invoices',
      title: `${overdueInvoices} overdue invoice(s) with open balance`,
      detail: 'Outstanding overdue invoices can indicate failed collections, missed dunning, or stale payment allocation.',
      action: 'Open finance aging and inspect overdue balances.',
      module: 'billing',
      metric: overdueInvoices,
    }));
  }

  if (expiredCustomers > 0) {
    issues.push(makeIssue({
      severity: expiredCustomers >= 25 ? 'critical' : 'warning',
      code: 'billing.expired_customers',
      title: `${expiredCustomers} customer account(s) are expired`,
      detail: 'Expired accounts may require collection action, suspension review, or payment reconciliation.',
      action: 'Review expired customers from the dashboard and confirm enforcement policy.',
      module: 'billing',
      metric: expiredCustomers,
    }));
  }

  return {
    key: 'billing',
    label: 'Billing & Revenue',
    status: moduleStatusFromIssues(issues.filter((issue) => issue.module === 'billing')),
    metrics: {
      overdueInvoices,
      outstandingBalance: Number(outstandingAgg?.[0]?.balanceDue || 0),
      expiringCustomers,
      expiredCustomers,
    },
  };
}

async function summarizePayments(tenantId, issues) {
  const [configs, problemEvents] = await Promise.all([
    PaymentConfig.find({ ispId: String(tenantId) }).select({ provider: 1, environment: 1, payMethod: 1 }).lean(),
    PaymentGatewayEvent.countDocuments({
      tenantId,
      eventStatus: { $in: ['failed', 'unmatched', 'rejected'] },
      createdAt: { $gte: since(1) },
    }),
  ]);

  if (!configs.length) {
    issues.push(makeIssue({
      severity: 'warning',
      code: 'payments.no_provider_config',
      title: 'No payment provider configuration found',
      detail: 'Tenant payment collection may not be fully configured.',
      action: 'Configure M-Pesa, Stripe, or PayPal in payment settings.',
      module: 'payments',
      metric: 0,
    }));
  }

  if (problemEvents > 0) {
    issues.push(makeIssue({
      severity: problemEvents >= 10 ? 'critical' : 'warning',
      code: 'payments.gateway_event_backlog',
      title: `${problemEvents} problematic gateway event(s) in the last 24 hours`,
      detail: 'Failed, unmatched, or rejected gateway events can leave payments unapplied.',
      action: 'Open payment gateway events and resolve or retry the affected callbacks.',
      module: 'payments',
      metric: problemEvents,
    }));
  }

  return {
    key: 'payments',
    label: 'Payments',
    status: moduleStatusFromIssues(issues.filter((issue) => issue.module === 'payments')),
    metrics: {
      providerConfigs: configs.length,
      problemEventsLast24h: problemEvents,
    },
    sample: configs.map((config) => ({
      provider: config.provider,
      environment: config.environment || null,
      payMethod: config.payMethod || null,
    })),
  };
}

async function summarizeSupportAndNoc(tenantId, issues) {
  const [overdueTickets, urgentTickets, activeIncidents] = await Promise.all([
    SupportTicket.countDocuments({
      tenantId,
      status: { $in: ['open', 'in_progress', 'waiting'] },
      resolutionDueAt: { $lt: new Date() },
    }),
    SupportTicket.countDocuments({
      tenantId,
      status: { $in: ['open', 'in_progress', 'waiting'] },
      priority: { $in: ['high', 'urgent'] },
    }),
    NocIncident.countDocuments({
      tenantId,
      status: { $in: ['open', 'investigating', 'monitoring', 'scheduled'] },
      severity: { $in: ['high', 'critical'] },
    }),
  ]);

  if (activeIncidents > 0) {
    issues.push(makeIssue({
      severity: 'critical',
      code: 'noc.active_high_severity',
      title: `${activeIncidents} high-severity NOC incident(s) active`,
      detail: 'High severity incidents can impact multiple customers or core infrastructure.',
      action: 'Open NOC and update incident status, impact scope, and customer communications.',
      module: 'operations',
      metric: activeIncidents,
    }));
  }

  if (overdueTickets > 0) {
    issues.push(makeIssue({
      severity: overdueTickets >= 10 ? 'critical' : 'warning',
      code: 'support.overdue_tickets',
      title: `${overdueTickets} support ticket(s) breached resolution SLA`,
      detail: 'Overdue support tickets are a customer-experience and retention risk.',
      action: 'Open Support Ops and reprioritize breached tickets.',
      module: 'operations',
      metric: overdueTickets,
    }));
  }

  return {
    key: 'operations',
    label: 'Support & NOC',
    status: moduleStatusFromIssues(issues.filter((issue) => issue.module === 'operations')),
    metrics: {
      activeHighSeverityIncidents: activeIncidents,
      overdueTickets,
      urgentTickets,
    },
  };
}

function providerConfigured(settings) {
  const provider = settings?.primaryProvider || 'twilio';
  if (provider === 'twilio') return Boolean(settings?.twilio?.accountSid && settings?.twilio?.authToken && (settings?.twilio?.from || settings?.senderId));
  if (provider === 'africastalking') return Boolean(settings?.africastalking?.apiKey && settings?.africastalking?.username);
  if (provider === 'textsms') return Boolean(settings?.textsms?.apiKey && settings?.textsms?.partnerId && settings?.textsms?.baseUrl);
  return false;
}

async function summarizeCommunications(tenantId, issues) {
  const [settings, failures, skipped] = await Promise.all([
    SmsSettings.findOne({ tenantId }).lean(),
    MessageDelivery.countDocuments({ tenantId, status: 'failed', createdAt: { $gte: since(1) } }),
    MessageDelivery.countDocuments({ tenantId, status: 'skipped', createdAt: { $gte: since(1) } }),
  ]);

  if (settings?.enabled && !providerConfigured(settings)) {
    issues.push(makeIssue({
      severity: 'warning',
      code: 'communications.provider_incomplete',
      title: 'SMS is enabled but provider credentials look incomplete',
      detail: 'Outbound reminders, paylinks, and campaigns may fail at send time.',
      action: 'Open SMS settings and verify the primary provider credentials.',
      module: 'communications',
      metric: 1,
    }));
  }

  if (failures > 0) {
    issues.push(makeIssue({
      severity: failures >= 20 ? 'critical' : 'warning',
      code: 'communications.delivery_failures',
      title: `${failures} SMS delivery failure(s) in the last 24 hours`,
      detail: 'Recent delivery failures may indicate bad provider credentials, provider outage, or invalid contacts.',
      action: 'Open Communications and inspect recent failures.',
      module: 'communications',
      metric: failures,
    }));
  }

  return {
    key: 'communications',
    label: 'Communications',
    status: moduleStatusFromIssues(issues.filter((issue) => issue.module === 'communications')),
    metrics: {
      smsEnabled: settings?.enabled === true,
      primaryProvider: settings?.primaryProvider || null,
      failuresLast24h: failures,
      skippedLast24h: skipped,
    },
  };
}

async function getTenantOpsHealth(tenantId) {
  const issues = [];
  const mongo = mongoose.connection?.readyState === 1 ? 'up' : 'down';
  if (mongo !== 'up') {
    issues.push(makeIssue({
      severity: 'critical',
      code: 'platform.mongo_down',
      title: 'Database connection is down',
      detail: 'The app cannot reliably read or persist tenant data.',
      action: 'Check MongoDB connectivity and application logs immediately.',
      module: 'platform',
      metric: 0,
    }));
  }

  const modules = [];
  modules.push({
    key: 'platform',
    label: 'Platform',
    status: mongo === 'up' ? 'healthy' : 'critical',
    metrics: {
      mongo,
      uptimeSeconds: Math.round(process.uptime()),
    },
  });

  const routerModule = summarizeRouters(tenantId, issues);
  const [
    jobsModule,
    billingModule,
    paymentsModule,
    operationsModule,
    communicationsModule,
  ] = await Promise.all([
    summarizeJobs(tenantId, issues),
    summarizeBilling(tenantId, issues),
    summarizePayments(tenantId, issues),
    summarizeSupportAndNoc(tenantId, issues),
    summarizeCommunications(tenantId, issues),
  ]);

  modules.push(routerModule, jobsModule, billingModule, paymentsModule, operationsModule, communicationsModule);

  const sortedIssues = issues.sort((a, b) => {
    const severityDelta = severityRank(b.severity) - severityRank(a.severity);
    if (severityDelta) return severityDelta;
    return String(a.code).localeCompare(String(b.code));
  });
  const score = calculateHealthScore(sortedIssues);

  return {
    ok: score >= 70,
    score,
    label: healthLabel(score),
    generatedAt: new Date().toISOString(),
    severityCounts: countBySeverity(sortedIssues),
    modules,
    issues: sortedIssues,
  };
}

module.exports = {
  calculateHealthScore,
  countBySeverity,
  getTenantOpsHealth,
  healthLabel,
  makeIssue,
  moduleStatusFromIssues,
  severityRank,
  tenantMatchValue,
};
