'use strict';

const assert = require('assert');
const test = require('node:test');

const {
  getEnvReport,
  normalizeEnv,
  sanitizedValue,
  validateEnv,
} = require('../utils/env');

test('normalizeEnv mirrors MONGODB_URI into MONGO_URI', () => {
  const normalized = normalizeEnv({ MONGODB_URI: 'mongodb://example/app' });

  assert.equal(normalized.MONGO_URI, 'mongodb://example/app');
  assert.equal(normalized.MONGODB_URI, 'mongodb://example/app');
});

test('getEnvReport flags required database and jwt settings', () => {
  const report = getEnvReport({});

  assert.equal(report.ok, false);
  assert.deepEqual(report.errors.map((item) => item.key), ['MONGO_URI', 'JWT_SECRET']);
});

test('getEnvReport validates URLs and MPESA environment values', () => {
  const report = getEnvReport({
    MONGO_URI: 'mongodb://example/app',
    JWT_SECRET: 'long-enough-secret',
    MPESA_ENV: 'live',
    CLIENT_URL: 'not-a-url',
  });

  assert.equal(report.ok, false);
  assert.deepEqual(
    report.errors.map((item) => item.key),
    ['MPESA_ENV', 'CLIENT_URL']
  );
});

test('getEnvReport warns on short production secrets without exposing values', () => {
  const report = getEnvReport({
    NODE_ENV: 'production',
    MONGO_URI: 'mongodb://example/app',
    JWT_SECRET: 'short-but-ok',
    CLIENT_URL: 'https://isp.example.com',
  });

  assert.equal(report.ok, true);
  assert.deepEqual(report.warnings.map((item) => item.key), ['JWT_SECRET']);
  assert.equal(report.sanitized.JWT_SECRET, '<set:12 chars>');
  assert.equal(report.sanitized.MONGO_URI, '<set>');
});

test('sanitizedValue redacts known secrets', () => {
  assert.equal(sanitizedValue('JWT_SECRET', 'super-secret-value'), '<set:18 chars>');
  assert.equal(sanitizedValue('CLIENT_URL', 'https://isp.example.com'), 'https://isp.example.com');
});

test('validateEnv writes MongoDB aliases back onto provided env object', () => {
  const env = {
    MONGODB_URI: 'mongodb://example/app',
    JWT_SECRET: 'long-enough-secret',
  };

  const normalized = validateEnv(env);

  assert.equal(normalized.MONGO_URI, 'mongodb://example/app');
  assert.equal(env.MONGO_URI, 'mongodb://example/app');
  assert.equal(env.MONGODB_URI, 'mongodb://example/app');
});
