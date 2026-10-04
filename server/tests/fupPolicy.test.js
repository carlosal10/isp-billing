'use strict';
const assert = require('node:assert/strict'); const { test } = require('node:test');
const FupPolicy = require('../models/FupPolicy'); const FupState = require('../models/FupState');
test('FUP policies and states preserve byte counters as decimal strings', () => { assert.equal(FupPolicy.schema.path('includedBytes').instance, 'String'); assert.equal(FupState.schema.path('consumedBytes').instance, 'String'); assert.deepEqual(FupState.schema.path('state').enumValues, ['normal', 'warned', 'throttled', 'blocked', 'overridden']); });
