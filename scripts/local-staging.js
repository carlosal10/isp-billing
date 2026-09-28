'use strict';
// Always creates a disposable replica set. Never accepts an external database URI.
const { configureTestEnvironment, createTestDatabase } = require('../server/testing/environment');
configureTestEnvironment();
process.env.SERVE_CLIENT = 'true';
(async () => {
  const replica = await createTestDatabase();
  const app = require('../server/App');
  await app.start({ port: 5000, host: '127.0.0.1', jobs: false, signals: false });
  const mongoose = require('mongoose');
  for (const model of Object.values(mongoose.models)) await model.init();
  const { seedTestData } = require('../server/testing/seed');
  await seedTestData();
  console.log('Disposable staging ready: http://localhost:5000/login');
  console.log('Demo login: owner@demo.example / Demo-Only-2026!');
  console.log('Portal: Demo Fiber / DEMO-1001 / 654321. Scheduled jobs are disabled.');
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await app.stop(); await replica.stop(); };
  process.once('SIGINT', () => stop().then(() => process.exit()));
  process.once('SIGTERM', () => stop().then(() => process.exit()));
})().catch((err) => { console.error(err); process.exit(1); });
