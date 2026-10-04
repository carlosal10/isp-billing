'use strict';
const assert = require('node:assert/strict'); const { test } = require('node:test');
test('FUP evaluation defaults to a five-minute cadence', () => assert.equal(process.env.FUP_EVALUATION_CRON || '*/5 * * * *', '*/5 * * * *'));
