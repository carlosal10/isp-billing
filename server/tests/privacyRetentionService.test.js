'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FINAL_GATEWAY_EVENT_STATUSES,
  buildPrivacyRetentionPlan,
  cutoffDate,
  executeRetentionPlan,
} = require('../services/privacyRetentionService');

const VALID_ENV = {
  AUDIT_LOG_RETENTION_DAYS: '365',
  MESSAGE_DELIVERY_RETENTION_DAYS: '365',
  PAYMENT_GATEWAY_EVENT_RETENTION_DAYS: '730',
  PLATFORM_GATEWAY_EVENT_ACTION_RETENTION_DAYS: '730',
  JOB_RUN_RETENTION_DAYS: '90',
  JOB_ACTION_RETENTION_DAYS: '180',
};

function stubModel({ count = 0, deleted = 0 } = {}) {
  const calls = { count: [], delete: [] };
  return {
    calls,
    countDocuments: async (filter) => {
      calls.count.push(filter);
      return count;
    },
    deleteMany: async (filter) => {
      calls.delete.push(filter);
      return { deletedCount: deleted };
    },
  };
}

function stubModels() {
  return {
    AuditLog: stubModel({ count: 2, deleted: 2 }),
    MessageDelivery: stubModel({ count: 3, deleted: 3 }),
    PaymentGatewayEvent: stubModel({ count: 4, deleted: 4 }),
    PlatformGatewayEventAction: stubModel({ count: 5, deleted: 5 }),
  };
}

test('cutoffDate subtracts retention days from a fixed clock', () => {
  const cutoff = cutoffDate(new Date('2026-05-16T00:00:00.000Z'), 30);
  assert.equal(cutoff.toISOString(), '2026-04-16T00:00:00.000Z');
});

test('buildPrivacyRetentionPlan creates safe collection filters', () => {
  const plan = buildPrivacyRetentionPlan({
    env: VALID_ENV,
    now: new Date('2026-05-16T00:00:00.000Z'),
  });

  const gateway = plan.collections.find((item) => item.key === 'paymentGatewayEvents');

  assert.equal(plan.ok, true);
  assert.equal(plan.collections.length, 4);
  assert.deepEqual(gateway.filter.eventStatus.$in, FINAL_GATEWAY_EVENT_STATUSES);
  assert.equal(gateway.filter.createdAt.$lt.toISOString(), '2024-05-16T00:00:00.000Z');
});

test('executeRetentionPlan dry-run counts without deleting', async () => {
  const models = stubModels();
  const result = await executeRetentionPlan({
    dryRun: true,
    env: VALID_ENV,
    now: new Date('2026-05-16T00:00:00.000Z'),
    models,
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.totalMatched, 14);
  assert.equal(result.totalDeleted, 0);
  assert.equal(models.AuditLog.calls.count.length, 1);
  assert.equal(models.AuditLog.calls.delete.length, 0);
});

test('executeRetentionPlan write mode deletes eligible records', async () => {
  const models = stubModels();
  const result = await executeRetentionPlan({
    dryRun: false,
    env: VALID_ENV,
    now: new Date('2026-05-16T00:00:00.000Z'),
    models,
  });

  assert.equal(result.dryRun, false);
  assert.equal(result.totalMatched, 14);
  assert.equal(result.totalDeleted, 14);
  assert.equal(models.PaymentGatewayEvent.calls.delete.length, 1);
  assert.deepEqual(
    models.PaymentGatewayEvent.calls.delete[0].eventStatus.$in,
    FINAL_GATEWAY_EVENT_STATUSES
  );
});

test('executeRetentionPlan rejects invalid policy settings', async () => {
  await assert.rejects(
    () => executeRetentionPlan({
      env: { ...VALID_ENV, AUDIT_LOG_RETENTION_DAYS: '1' },
      models: stubModels(),
    }),
    /Privacy retention policy is invalid/
  );
});
