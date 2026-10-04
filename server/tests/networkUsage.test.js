'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const UsageCounter = require('../models/UsageCounter');
test('usage API data source keeps counters as decimal strings', () => {
  assert.equal(UsageCounter.schema.path('inputBytes').instance, 'String');
  assert.equal(UsageCounter.schema.path('outputBytes').instance, 'String');
});
