'use strict';
const assert = require('node:assert/strict'); const { test } = require('node:test');
test('hotspot FUP adapter requires an explicit username', async () => { const { applyHotspotFup } = require('../services/networkOperationService'); await assert.rejects(() => applyHotspotFup({ tenantId: '507f1f77bcf86cd799439011', routerId: '507f1f77bcf86cd799439012' }, { operationType: 'fup.apply' }), /no username/); });
