'use strict';
const assert = require('node:assert/strict'); const { test } = require('node:test');
test('FUP restore operations use an assignment normal rate when configured', () => { const assignment = { metadata: { normalRateLimit: '20M/5M' } }; assert.equal(assignment.metadata.normalRateLimit, '20M/5M'); });
