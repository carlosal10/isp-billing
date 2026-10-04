'use strict';
const assert = require('node:assert/strict');
const UsageCounter = require('../models/UsageCounter');
const { test } = require('node:test');
test('usage counters store byte totals as strings and preserve 64-bit values', () => {
  assert.equal(UsageCounter.schema.path('inputBytes').instance, 'String');
  assert.equal(UsageCounter.schema.path('outputBytes').instance, 'String');
  assert.ok(UsageCounter.schema.indexes().some(([fields, options]) => options.unique && fields.sessionKey));
});
