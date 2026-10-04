'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const NetworkOperation = require('../models/NetworkOperation');
const { processNetworkOperations } = require('../services/networkOperationService');

test('network operation model supports leases for safe worker claims', () => {
  assert.equal(NetworkOperation.schema.path('leaseToken').options.select, false);
  assert.equal(NetworkOperation.schema.path('leaseUntil').options.default, null);
});

test('operation worker returns an empty summary when there is no due work', async () => {
  const original = NetworkOperation.findOneAndUpdate;
  NetworkOperation.findOneAndUpdate = () => ({ lean: async () => null });
  try { assert.deepEqual(await processNetworkOperations({ limit: 1 }), { completed: 0, retried: 0, failed: 0, unsupported: 0 }); }
  finally { NetworkOperation.findOneAndUpdate = original; }
});

test('PPPoE adapter requires an explicit username before touching a router', async () => {
  const { applyPppoeAssignment } = require('../services/networkOperationService');
  await assert.rejects(() => applyPppoeAssignment({ tenantId: '507f1f77bcf86cd799439011', routerId: '507f1f77bcf86cd799439012', desiredState: 'present' }), /no username/);
});

test('RADIUS adapter rejects local assignments before touching a router', async () => {
  const { configureRadiusForAssignment } = require('../services/networkOperationService');
  await assert.rejects(() => configureRadiusForAssignment({ authenticationMode: 'local' }), /authenticationMode=radius/);
});
