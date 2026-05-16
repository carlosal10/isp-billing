'use strict';

const AuditLog = require('../models/AuditLog');
const MessageDelivery = require('../models/MessageDelivery');
const PaymentGatewayEvent = require('../models/PaymentGatewayEvent');
const PlatformGatewayEventAction = require('../models/PlatformGatewayEventAction');
const { buildPrivacyPolicyReport } = require('./privacyPolicyService');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const FINAL_GATEWAY_EVENT_STATUSES = Object.freeze(['processed', 'unmatched', 'failed', 'rejected']);

const DEFAULT_MODELS = Object.freeze({
  AuditLog,
  MessageDelivery,
  PaymentGatewayEvent,
  PlatformGatewayEventAction,
});

function cutoffDate(now, days) {
  const base = now instanceof Date ? now : new Date(now);
  return new Date(base.getTime() - Number(days) * MS_PER_DAY);
}

function retentionDaysByKey(report) {
  return Object.fromEntries((report.retention || []).map((item) => [item.key, item.days]));
}

function collectionPlan({ key, label, modelName, dateField, days, cutoff, extraFilter = {} }) {
  return {
    key,
    label,
    modelName,
    dateField,
    days,
    cutoff,
    filter: {
      [dateField]: { $lt: cutoff },
      ...extraFilter,
    },
  };
}

function buildPrivacyRetentionPlan({ env = process.env, now = new Date() } = {}) {
  const report = buildPrivacyPolicyReport(env);
  const generatedAt = now instanceof Date ? now : new Date(now);

  if (!report.ok) {
    return {
      ok: false,
      generatedAt: generatedAt.toISOString(),
      errors: report.errors,
      warnings: report.warnings,
      collections: [],
    };
  }

  const days = retentionDaysByKey(report);
  const paymentGatewayCutoff = cutoffDate(generatedAt, days.paymentGatewayEvents);

  return {
    ok: true,
    generatedAt: generatedAt.toISOString(),
    errors: report.errors,
    warnings: report.warnings,
    collections: [
      collectionPlan({
        key: 'auditLogs',
        label: 'Audit logs',
        modelName: 'AuditLog',
        dateField: 'createdAt',
        days: days.auditLogs,
        cutoff: cutoffDate(generatedAt, days.auditLogs),
      }),
      collectionPlan({
        key: 'messageDeliveries',
        label: 'Message deliveries',
        modelName: 'MessageDelivery',
        dateField: 'createdAt',
        days: days.messageDeliveries,
        cutoff: cutoffDate(generatedAt, days.messageDeliveries),
      }),
      collectionPlan({
        key: 'paymentGatewayEvents',
        label: 'Final payment gateway events',
        modelName: 'PaymentGatewayEvent',
        dateField: 'createdAt',
        days: days.paymentGatewayEvents,
        cutoff: paymentGatewayCutoff,
        extraFilter: { eventStatus: { $in: FINAL_GATEWAY_EVENT_STATUSES } },
      }),
      collectionPlan({
        key: 'platformGatewayEventActions',
        label: 'Platform gateway event actions',
        modelName: 'PlatformGatewayEventAction',
        dateField: 'createdAt',
        days: days.platformGatewayEventActions,
        cutoff: cutoffDate(generatedAt, days.platformGatewayEventActions),
      }),
    ],
  };
}

async function executeRetentionPlan({
  dryRun = true,
  env = process.env,
  now = new Date(),
  models = DEFAULT_MODELS,
} = {}) {
  const plan = buildPrivacyRetentionPlan({ env, now });
  if (!plan.ok) {
    const error = new Error('Privacy retention policy is invalid.');
    error.report = plan;
    throw error;
  }

  const results = [];
  for (const item of plan.collections) {
    const model = models[item.modelName];
    if (!model) {
      throw new Error(`Missing retention model dependency: ${item.modelName}`);
    }

    if (dryRun) {
      const count = await model.countDocuments(item.filter);
      results.push({
        ...item,
        dryRun: true,
        matchedCount: Number(count) || 0,
        deletedCount: 0,
      });
      continue;
    }

    const result = await model.deleteMany(item.filter);
    results.push({
      ...item,
      dryRun: false,
      matchedCount: Number(result?.deletedCount) || 0,
      deletedCount: Number(result?.deletedCount) || 0,
    });
  }

  return {
    ok: true,
    dryRun: dryRun === true,
    generatedAt: plan.generatedAt,
    warnings: plan.warnings,
    collections: results,
    totalMatched: results.reduce((sum, item) => sum + item.matchedCount, 0),
    totalDeleted: results.reduce((sum, item) => sum + item.deletedCount, 0),
  };
}

async function prunePrivacyRetention(options = {}) {
  return executeRetentionPlan({ ...options, dryRun: false });
}

module.exports = {
  FINAL_GATEWAY_EVENT_STATUSES,
  buildPrivacyRetentionPlan,
  cutoffDate,
  executeRetentionPlan,
  prunePrivacyRetention,
};
