'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { connectionDiagnostic, validRouterHost } = require('../services/routerConnectionDiagnostics');
const { normalizeAccounting } = require('../services/radiusAccountingService');
const { createPppoeService } = require('../services/pppoeService');

test('router hosts accept tunnel addresses and reject MAC addresses or malformed names', () => {
  assert.equal(validRouterHost('10.77.0.2'), true);
  assert.equal(validRouterHost('router.example.com'), true);
  assert.equal(validRouterHost('AA:BB:CC:DD:EE:FF'), false);
  assert.equal(validRouterHost('router.example.com/path'), false);
});

test('connection diagnostics explain NAT, API and TLS failures without exposing credentials', () => {
  assert.match(connectionDiagnostic(Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })).message, /VPN route/);
  assert.equal(connectionDiagnostic(new Error('CANTLOGIN')).code, 'auth');
  assert.equal(connectionDiagnostic(new Error('certificate verify failed')).code, 'tls');
});

test('RADIUS accounting preserves 64-bit counters and rejects unsafe input', () => {
  const row = normalizeAccounting({ routerId: '507f1f77bcf86cd799439011', sessionKey: 's1', username: 'alice', event: 'interim', occurredAt: new Date().toISOString(), sessionSeconds: 30, uploadBytes: '18446744073709551615', downloadBytes: '10' });
  assert.equal(row.uploadBytes, '18446744073709551615');
  assert.throws(() => normalizeAccounting({ ...row, uploadBytes: '18446744073709551616' }), /unsigned 64-bit/);
});

test('PPPoE service always scopes commands and verifies state transitions', async () => {
  const calls = [];
  const rows = { users: [{ '.id': '*1', name: 'ACC-1', service: 'pppoe', disabled: 'yes' }] };
  const service = createPppoeService(async (path, words, context) => {
    calls.push({ path, words, context });
    if (path.endsWith('/print')) return path.includes('secret') ? rows.users : [];
    if (path === '/ppp/secret/set') rows.users[0].disabled = 'no';
    return [];
  });
  await service.setEnabled({ tenantId: 'tenant', serverId: 'router' }, ['ACC-1'], true);
  assert.equal(calls.every(call => call.context.tenantId === 'tenant' && call.context.serverId === 'router'), true);
  assert.ok(calls.some(call => call.path === '/ppp/secret/set' && call.words.includes('=.id=*1')));
});
