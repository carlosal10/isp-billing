'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isAllowed,
  canUseTerminalRole,
  sanitizeTerminalResult,
  sanitizeTerminalWords,
} = require('../services/terminal');

test('terminal rejects secret printing and commands appended to an allowed path', () => {
  assert.equal(isAllowed('/system/resource/print'), true);
  assert.equal(isAllowed('/ppp/secret/print'), false);
  assert.equal(isAllowed('/system/resource/print/evil'), false);
});

test('terminal access is limited to owner and admin memberships', () => {
  assert.equal(canUseTerminalRole('owner'), true);
  assert.equal(canUseTerminalRole('admin'), true);
  assert.equal(canUseTerminalRole('operator'), false);
  assert.equal(canUseTerminalRole('platform-admin'), false);
  assert.equal(canUseTerminalRole(null), false);
});

test('terminal output redacts nested credential fields and command arguments', () => {
  const result = sanitizeTerminalResult({
    name: 'subscriber-a',
    password: 'router-secret',
    nested: {
      token: 'bearer-secret',
      safe: 'visible',
    },
    raw: '=password=inline-secret =name=ok',
  });

  assert.equal(result.password, '[REDACTED]');
  assert.equal(result.nested.token, '[REDACTED]');
  assert.equal(result.nested.safe, 'visible');
  assert.doesNotMatch(result.raw, /inline-secret/);
  assert.match(result.raw, /\*\*\*\*\*\*/);

  const words = sanitizeTerminalWords(['=password=inline-secret', '=name=ok']);
  assert.doesNotMatch(words[0], /inline-secret/);
  assert.equal(words[1], '=name=ok');
});
