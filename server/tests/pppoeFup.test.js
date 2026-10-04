'use strict';
const assert = require('node:assert/strict'); const { test } = require('node:test');
test('PPPoE FUP adapter requires local authentication', async () => { const { applyPppoeFup } = require('../services/networkOperationService'); await assert.rejects(() => applyPppoeFup({ authenticationMode: 'radius' }, { operationType: 'fup.apply' }), /CoA/); });
