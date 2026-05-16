'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAuditLogFilter,
  normalizeAuditLogQuery,
  redactPayload,
  serializeAuditLog,
} = require('../services/auditLogService');

test('normalizeAuditLogQuery clamps pagination and parses date bounds', () => {
  const normalized = normalizeAuditLogQuery({
    limit: '999',
    page: '2',
    sort: 'asc',
    from: '2026-05-01',
    to: '2026-05-07',
  });

  assert.equal(normalized.limit, 250);
  assert.equal(normalized.page, 2);
  assert.equal(normalized.skip, 250);
  assert.equal(normalized.sort, 'asc');
  assert.equal(normalized.from.toISOString().startsWith('2026-05-01'), true);
  assert.equal(normalized.to.getHours(), 23);
});

test('buildAuditLogFilter scopes by tenant and supports common free-text fields', () => {
  const filter = buildAuditLogFilter('tenant-1', normalizeAuditLogQuery({ q: 'INV-100' }));

  assert.equal(filter.tenantId, 'tenant-1');
  assert.equal(Array.isArray(filter.$or), true);
  assert.equal(filter.$or.some((entry) => Object.hasOwn(entry, 'payload.invoiceId')), true);
});

test('redactPayload removes sensitive nested values', () => {
  const redacted = redactPayload({
    token: 'abc',
    nested: {
      authorization: 'Bearer secret',
      accountNumber: 'AC-1',
      consumerSecret: 'mpesa-secret',
      pinHash: 'hash',
    },
  });

  assert.equal(redacted.token, '[redacted]');
  assert.equal(redacted.nested.authorization, '[redacted]');
  assert.equal(redacted.nested.consumerSecret, '[redacted]');
  assert.equal(redacted.nested.pinHash, '[redacted]');
  assert.equal(redacted.nested.accountNumber, 'AC-1');
});

test('serializeAuditLog returns payload redacted for API output', () => {
  const serialized = serializeAuditLog({
    _id: 'log-1',
    tenantId: 'tenant-1',
    actor: 'admin@example.com',
    action: 'payment.refund',
    payload: { password: 'secret', paymentId: 'pay-1' },
  });

  assert.equal(serialized._id, 'log-1');
  assert.equal(serialized.payload.password, '[redacted]');
  assert.equal(serialized.payload.paymentId, 'pay-1');
});
