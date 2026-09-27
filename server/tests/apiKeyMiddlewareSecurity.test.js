'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createApiKeyAuth } = require('../middleware/apiKey');

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('API key middleware rejects query-string credentials', async () => {
  let lookupCalled = false;
  const middleware = createApiKeyAuth({
    lookup: async () => {
      lookupCalled = true;
      return { _id: 'key-1', tenantId: 'tenant-a' };
    },
  });
  const response = responseDouble();

  await middleware(
    { headers: {}, query: { apiKey: 'secret-key' } },
    response,
    () => assert.fail('query-string API keys must not authenticate')
  );

  assert.equal(response.statusCode, 401);
  assert.equal(lookupCalled, false);
});

test('API key middleware authenticates only through the header', async () => {
  const seen = [];
  const middleware = createApiKeyAuth({
    lookup: async (raw) => {
      seen.push(raw);
      return { _id: 'key-1', tenantId: 'tenant-a' };
    },
    touch: async () => {},
  });
  const request = { headers: { 'x-api-key': 'secret-key' }, query: {} };
  const response = responseDouble();
  let nextCalled = false;

  await middleware(request, response, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.deepEqual(seen, ['secret-key']);
  assert.equal(request.tenantId, 'tenant-a');
  assert.equal(request.apiKey._id, 'key-1');
});
