'use strict';
const crypto = require('node:crypto');
function configureTestEnvironment() {
  Object.assign(process.env, { NODE_ENV: 'test', MPESA_ENV: 'sandbox',
    JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    DATA_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
    CLIENT_URL: 'http://localhost:5000', PUBLIC_BASE_URL: 'http://localhost:5000',
    CLIENT_ORIGINS: 'http://localhost:5000,http://127.0.0.1:5000',
  });
  for (const name of ['DATA_ENCRYPTION_KEYS', 'DATA_ENCRYPTION_ACTIVE_KEY_ID', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'PLATFORM_BOOTSTRAP_TOKEN']) delete process.env[name];
}
async function createTestDatabase() {
  const { MongoMemoryReplSet } = require('mongodb-memory-server');
  const replica = await MongoMemoryReplSet.create({ binary: { version: process.env.MONGOMS_VERSION || '8.2.6' }, replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.MONGO_URI = replica.getUri('isp_readiness_test');
  return replica;
}
module.exports = { configureTestEnvironment, createTestDatabase };
