'use strict';

const assert = require('assert');
const test = require('node:test');

const {
  REQUEST_ID_HEADER,
  generateRequestId,
  requestContext,
  sanitizeRequestId,
} = require('../middleware/requestContext');
const {
  BASE_SECURITY_HEADERS,
  applySecurityHeaders,
  requestLooksSecure,
  shouldApplyHsts,
} = require('../middleware/securityHeaders');

function fakeResponse() {
  const headers = new Map();
  return {
    locals: {},
    setHeader(key, value) {
      headers.set(key.toLowerCase(), value);
    },
    getHeader(key) {
      return headers.get(key.toLowerCase());
    },
  };
}

test('sanitizeRequestId accepts safe request ids only', () => {
  assert.equal(sanitizeRequestId('trace-1234:abcd'), 'trace-1234:abcd');
  assert.equal(sanitizeRequestId('short'), null);
  assert.equal(sanitizeRequestId('bad request id'), null);
  assert.equal(sanitizeRequestId('<script>alert(1)</script>'), null);
});

test('generateRequestId creates platform-prefixed ids', () => {
  assert.match(generateRequestId(), /^req_[a-f0-9]{24}$/);
});

test('requestContext preserves trusted incoming request ids', () => {
  const req = { headers: { 'x-request-id': 'trace-1234:abcd' } };
  const res = fakeResponse();
  let called = false;

  requestContext()(req, res, () => {
    called = true;
  });

  assert.equal(called, true);
  assert.equal(req.id, 'trace-1234:abcd');
  assert.equal(res.locals.requestId, 'trace-1234:abcd');
  assert.equal(res.getHeader(REQUEST_ID_HEADER), 'trace-1234:abcd');
});

test('requestContext replaces unsafe incoming ids', () => {
  const req = { headers: { 'x-request-id': 'bad id' } };
  const res = fakeResponse();

  requestContext()(req, res, () => {});

  assert.match(req.id, /^req_[a-f0-9]{24}$/);
  assert.equal(res.getHeader(REQUEST_ID_HEADER), req.id);
});

test('applySecurityHeaders sets baseline defensive headers', () => {
  const res = fakeResponse();

  applySecurityHeaders({ headers: {} }, res, { env: { NODE_ENV: 'test' } });

  Object.entries(BASE_SECURITY_HEADERS).forEach(([key, value]) => {
    assert.equal(res.getHeader(key), value);
  });
  assert.equal(res.getHeader('Strict-Transport-Security'), undefined);
});

test('applySecurityHeaders enables HSTS in production or secure requests', () => {
  const prodRes = fakeResponse();
  applySecurityHeaders({ headers: {} }, prodRes, { env: { NODE_ENV: 'production' } });
  assert.equal(prodRes.getHeader('Strict-Transport-Security'), 'max-age=15552000; includeSubDomains');

  const secureRes = fakeResponse();
  applySecurityHeaders({ headers: { 'x-forwarded-proto': 'https' } }, secureRes, { env: { NODE_ENV: 'test' } });
  assert.equal(secureRes.getHeader('Strict-Transport-Security'), 'max-age=15552000; includeSubDomains');
});

test('requestLooksSecure and shouldApplyHsts understand proxy headers', () => {
  assert.equal(requestLooksSecure({ headers: { 'x-forwarded-proto': 'https,http' } }), true);
  assert.equal(shouldApplyHsts({ headers: {} }, { NODE_ENV: 'production' }), true);
});
