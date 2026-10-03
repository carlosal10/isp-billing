'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeStatement, compareStatement } = require('../services/providerReconciliationService');
for (const provider of ['mpesa', 'stripe', 'paypal']) {
  test(`${provider} gross receipt fixture detects missing, duplicate and mismatched records by currency`, () => {
    const statement = normalizeStatement({ provider, start: '2026-09-01', end: '2026-10-01', rows: [
      { reference: 'matched', amount: 100, currency: 'KES', occurredAt: '2026-09-02' },
      { reference: 'missing', amount: 200, currency: 'KES', occurredAt: '2026-09-02' },
      { reference: 'mismatch', amount: 200, currency: 'USD', occurredAt: '2026-09-02' },
      { reference: 'duplicate', amount: 10, currency: 'KES', occurredAt: '2026-09-02' },
      { reference: 'duplicate', amount: 10, currency: 'KES', occurredAt: '2026-09-02' },
    ] });
    const result = compareStatement(statement, [
      { _id: '1', transactionId: 'matched', amount: 100, currency: 'KES' },
      { _id: '2', transactionId: 'mismatch', amount: 200, currency: 'KES' },
      { _id: '3', transactionId: 'internal-only', amount: 50, currency: 'KES' },
    ]);
    assert.deepEqual(Object.fromEntries(result.rows.map(r => [r.reference, r.status])), { duplicate: 'duplicate', 'internal-only': 'missing-provider-receipt', matched: 'matched', mismatch: 'mismatch', missing: 'missing-payment' });
    assert.equal(result.unresolved, 4);
    assert.deepEqual(result.totals, [{ currency: 'KES', provider: 320, internal: 350, difference: -30 }, { currency: 'USD', provider: 200, internal: 0, difference: 200 }]);
  });
}
test('statements reject invalid ranges, fractional cents and out-of-period receipts', () => {
  const input = { provider: 'mpesa', start: '2026-09-01', end: '2026-10-01', rows: [] };
  assert.throws(() => normalizeStatement({ ...input, end: '2026-09-01' }), /period/);
  assert.throws(() => normalizeStatement({ ...input, rows: [{ reference: 'x', currency: 'KES', amount: 1.001, occurredAt: '2026-09-02' }] }), /decimals/);
  assert.throws(() => normalizeStatement({ ...input, rows: [{ reference: 'x', currency: 'KES', amount: 1, occurredAt: '2026-10-01' }] }), /timestamps/);
});
