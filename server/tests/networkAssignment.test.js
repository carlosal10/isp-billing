'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const NetworkAssignment = require('../models/NetworkAssignment');
const NetworkOperation = require('../models/NetworkOperation');
const HotspotAccess = require('../models/HotspotAccess');

test('network assignments expose tenant, router, access type, and desired/observed state contracts', () => {
  const paths = NetworkAssignment.schema.paths;
  assert.equal(paths.tenantId.options.required, true);
  assert.equal(paths.routerId.options.required, true);
  assert.deepEqual(paths.accessType.enumValues, ['pppoe', 'static', 'hotspot']);
  assert.deepEqual(paths.authenticationMode.enumValues, ['local', 'radius']);
  assert.equal(paths.radiusServerId.options.ref, 'RadiusServer');
  assert.deepEqual(paths.desiredState.enumValues, ['absent', 'present', 'suspended']);
  assert.ok(NetworkAssignment.schema.indexes().some(([fields, options]) => options.unique && fields.customerId));
});

test('network operations require tenant-scoped idempotency and track retry state', () => {
  const paths = NetworkOperation.schema.paths;
  assert.equal(paths.tenantId.options.required, true);
  assert.equal(paths.idempotencyKey.options.required, true);
  assert.deepEqual(paths.status.enumValues, ['pending', 'processing', 'complete', 'failed', 'dead-letter']);
  assert.ok(NetworkOperation.schema.indexes().some(([fields, options]) => options.unique && fields.idempotencyKey));
});

test('hotspot credentials are excluded from normal reads and encrypted on write', () => {
  const path = HotspotAccess.schema.path('passwordEncrypted');
  assert.equal(path.options.select, false);
  assert.equal(typeof path.options.set, 'function');
});
