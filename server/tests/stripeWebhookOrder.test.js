'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

test('Stripe webhook is mounted before the global JSON parser', () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, '..', 'App.js'), 'utf8');
  const webhookMount = appSource.indexOf('app.use("/api/payment/stripe", stripeWebhook)');
  const jsonParser = appSource.indexOf('app.use(express.json(');

  assert.notEqual(webhookMount, -1, 'Stripe webhook mount is missing');
  assert.notEqual(jsonParser, -1, 'Global JSON parser is missing');
  assert.ok(webhookMount < jsonParser, 'Stripe webhook must receive raw bytes before JSON parsing');
});
