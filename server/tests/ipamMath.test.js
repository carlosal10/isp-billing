'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeIPv4,
  ipv4ToInt,
  intToIPv4,
  parseCidr,
  pickNextAvailableIp,
  poolUsageFromAssignments,
} = require('../services/ipamMath');

test('normalizeIPv4 trims and removes leading zeros', () => {
  assert.equal(normalizeIPv4(' 192.168.001.010 '), '192.168.1.10');
  assert.equal(normalizeIPv4('999.1.1.1'), null);
});

test('ipv4ToInt and intToIPv4 round-trip valid addresses', () => {
  const num = ipv4ToInt('10.0.0.25');
  assert.equal(intToIPv4(num), '10.0.0.25');
});

test('parseCidr derives usable host range for a /29 pool', () => {
  const parsed = parseCidr('192.168.50.6/29');
  assert.equal(parsed.cidr, '192.168.50.0/29');
  assert.equal(parsed.networkAddress, '192.168.50.0');
  assert.equal(parsed.broadcastAddress, '192.168.50.7');
  assert.equal(parsed.firstHost, '192.168.50.1');
  assert.equal(parsed.lastHost, '192.168.50.6');
  assert.equal(parsed.usableHostCount, 6);
  assert.equal(parsed.contains('192.168.50.4'), true);
  assert.equal(parsed.isUsableHost('192.168.50.0'), false);
});

test('pickNextAvailableIp skips allocated and gateway addresses', () => {
  const next = pickNextAvailableIp({
    cidr: '172.16.10.0/29',
    usedIps: ['172.16.10.1', '172.16.10.2'],
    excludedIps: ['172.16.10.3'],
  });
  assert.equal(next, '172.16.10.4');
});

test('pickNextAvailableIp works with list-based pools', () => {
  const next = pickNextAvailableIp({
    cidr: {
      allocationStrategy: 'list',
      addressList: ['10.0.0.10', '10.0.0.11', '10.0.0.12'],
    },
    usedIps: ['10.0.0.10'],
    excludedIps: ['10.0.0.11'],
  });
  assert.equal(next, '10.0.0.12');
});

test('poolUsageFromAssignments counts active allocations, reservations, and gateway holdback', () => {
  const usage = poolUsageFromAssignments(
    '10.10.10.0/29',
    [
      { ipAddress: '10.10.10.2', status: 'allocated' },
      { ipAddress: '10.10.10.3', status: 'reserved' },
    ],
    '10.10.10.1'
  );

  assert.deepEqual(usage, {
    usableHostCount: 6,
    allocatedCount: 1,
    reservedCount: 1,
    gatewayReserved: 1,
    freeCount: 3,
    utilizationPct: 50,
  });
});

test('poolUsageFromAssignments counts list-based pool capacity', () => {
  const usage = poolUsageFromAssignments(
    {
      allocationStrategy: 'list',
      addressList: ['192.168.1.10', '192.168.1.11', '192.168.1.12'],
    },
    [
      { ipAddress: '192.168.1.10', status: 'allocated' },
      { ipAddress: '192.168.1.11', status: 'reserved' },
    ]
  );

  assert.deepEqual(usage, {
    usableHostCount: 3,
    allocatedCount: 1,
    reservedCount: 1,
    gatewayReserved: 0,
    freeCount: 1,
    utilizationPct: 67,
  });
});
