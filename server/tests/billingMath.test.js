'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  allocateAmountOldestFirst,
  computeProrationDelta,
  computeInvoiceStatus,
  agingBucket,
  computeDunningStage,
} = require('../services/billingMath');

test('allocateAmountOldestFirst allocates oldest items before leaving remainder', () => {
  const result = allocateAmountOldestFirst(
    [
      { itemId: 'inv-1', outstanding: 50 },
      { itemId: 'inv-2', outstanding: 40 },
      { itemId: 'inv-3', outstanding: 30 },
    ],
    95
  );

  assert.equal(result.appliedTotal, 95);
  assert.equal(result.remaining, 0);
  assert.deepEqual(
    result.allocations.map((entry) => [entry.itemId, entry.amount]),
    [
      ['inv-1', 50],
      ['inv-2', 40],
      ['inv-3', 5],
    ]
  );
});

test('computeProrationDelta returns upgrade charge for remaining service window', () => {
  const delta = computeProrationDelta({
    oldPrice: 3000,
    oldDurationDays: 30,
    newPrice: 4500,
    newDurationDays: 30,
    remainingDays: 10,
  });

  assert.equal(delta, 500);
});

test('computeProrationDelta returns downgrade credit for remaining service window', () => {
  const delta = computeProrationDelta({
    oldPrice: 4500,
    oldDurationDays: 30,
    newPrice: 3000,
    newDurationDays: 30,
    remainingDays: 10,
  });

  assert.equal(delta, -500);
});

test('computeInvoiceStatus marks partially paid and overdue correctly', () => {
  const partiallyPaid = computeInvoiceStatus({
    total: 3000,
    amountPaid: 1000,
    amountCredited: 0,
    dueDate: new Date(Date.now() + 86400000),
  });
  const overdue = computeInvoiceStatus({
    total: 3000,
    amountPaid: 0,
    amountCredited: 0,
    dueDate: new Date(Date.now() - 86400000),
  });
  const paid = computeInvoiceStatus({
    total: 3000,
    amountPaid: 2000,
    amountCredited: 1000,
    dueDate: new Date(Date.now() - 86400000),
  });

  assert.equal(partiallyPaid, 'partially_paid');
  assert.equal(overdue, 'overdue');
  assert.equal(paid, 'paid');
});

test('agingBucket groups overdue balances into commercial aging buckets', () => {
  assert.equal(agingBucket(0), '0-30');
  assert.equal(agingBucket(30), '0-30');
  assert.equal(agingBucket(31), '31-60');
  assert.equal(agingBucket(61), '61-90');
  assert.equal(agingBucket(120), '90+');
});

test('computeDunningStage advances from upcoming to suspended by overdue age', () => {
  const now = new Date('2026-04-27T08:00:00.000Z');

  assert.equal(
    computeDunningStage({ dueDate: new Date('2026-04-29T00:00:00.000Z'), currentDate: now }),
    'upcoming'
  );
  assert.equal(
    computeDunningStage({ dueDate: new Date('2026-04-27T00:00:00.000Z'), currentDate: now }),
    'due'
  );
  assert.equal(
    computeDunningStage({
      dueDate: new Date('2026-04-25T00:00:00.000Z'),
      graceDays: 3,
      currentDate: now,
    }),
    'grace'
  );
  assert.equal(
    computeDunningStage({
      dueDate: new Date('2026-04-10T00:00:00.000Z'),
      graceDays: 3,
      currentDate: now,
    }),
    'collections'
  );
  assert.equal(
    computeDunningStage({
      dueDate: new Date('2026-03-01T00:00:00.000Z'),
      graceDays: 3,
      currentDate: now,
    }),
    'suspended'
  );
});
