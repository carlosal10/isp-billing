'use strict';

const assert = require('assert');
const test = require('node:test');

const {
  compareDeclaredIndexDrift,
  compareDeclaredIndexes,
  indexKey,
  indexSignature,
  normalizeIndexOptions,
  stableStringify,
} = require('../services/indexAuditService');

test('stableStringify produces deterministic object output', () => {
  assert.equal(stableStringify({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
});

test('indexKey preserves compound index order', () => {
  assert.equal(indexKey({ tenantId: 1, createdAt: -1 }), 'tenantId:1|createdAt:-1');
});

test('normalizeIndexOptions keeps only index-relevant fields', () => {
  assert.deepEqual(
    normalizeIndexOptions({
      unique: true,
      background: true,
      partialFilterExpression: { deletedAt: null },
    }),
    {
      unique: true,
      partialFilterExpression: { deletedAt: null },
    }
  );
});

test('indexSignature includes key and normalized options', () => {
  assert.equal(
    indexSignature({ tenantId: 1 }, { unique: true, background: true }),
    'tenantId:1::{"unique":true}'
  );
});

test('compareDeclaredIndexes reports missing declared indexes by key', () => {
  const missing = compareDeclaredIndexes(
    [
      { key: 'tenantId:1', spec: { tenantId: 1 }, options: {} },
      { key: 'customerId:1|createdAt:-1', spec: { customerId: 1, createdAt: -1 }, options: {} },
    ],
    [{ key: { tenantId: 1 }, name: 'tenantId_1' }]
  );

  assert.deepEqual(missing, [
    {
      key: 'customerId:1|createdAt:-1',
      spec: { customerId: 1, createdAt: -1 },
      options: {},
    },
  ]);
});

test('compareDeclaredIndexDrift reports option mismatches', () => {
  const drift = compareDeclaredIndexDrift(
    [{ key: 'email:1', spec: { email: 1 }, options: { unique: true } }],
    [{ key: { email: 1 }, name: 'email_1' }]
  );

  assert.deepEqual(drift.missing, []);
  assert.deepEqual(drift.mismatched, [
    {
      key: 'email:1',
      expectedOptions: { unique: true },
      actualOptions: {},
    },
  ]);
});
