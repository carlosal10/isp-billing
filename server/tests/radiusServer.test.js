'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const RadiusServer = require('../models/RadiusServer');

test('RADIUS shared secrets are write-only encrypted fields', () => {
  const path = RadiusServer.schema.path('sharedSecret');
  assert.equal(path.options.select, false);
  assert.equal(typeof path.options.set, 'function');
  assert.deepEqual(RadiusServer.schema.path('protocol').enumValues, ['udp', 'radsec']);
});
