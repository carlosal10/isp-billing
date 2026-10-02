'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const execute = require('node:util').promisify(execFile);
const { configureTestEnvironment, createTestDatabase } = require('../server/testing/environment');
configureTestEnvironment();
const mongoose = require('mongoose');
const { EJSON } = require('bson');
async function snapshot() {
  const result = {};
  for (const { name } of await mongoose.connection.db.listCollections().toArray()) {
    result[name] = {
      documents: EJSON.stringify(await mongoose.connection.db.collection(name).find({}).sort({ _id: 1 }).toArray()),
      indexes: (await mongoose.connection.db.collection(name).indexes()).map(({ name: indexName, key, unique, partialFilterExpression }) => ({ name: indexName, key, unique, partialFilterExpression })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
  return result;
}
async function run(script, args, env) {
  await execute(process.execPath, [script, ...args], { env: { ...process.env, ...env }, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
}
async function main() {
  let source, target;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'isp-restore-drill-'));
  try {
    source = await createTestDatabase(); const sourceUri = process.env.MONGO_URI;
    await mongoose.connect(sourceUri);
    const data = await require('../server/testing/seed').seedTestData();
    await require('../server/services/billingFinanceService').markInvoicePaidManually({ tenantId: data.tenants[0]._id, invoiceId: data.invoices[0]._id });
    await require('../server/services/providerReconciliationService').importStatement({ tenantId: data.tenants[0]._id, actor: 'restore-drill', provider: 'mpesa', start: '2026-09-01', end: '2026-10-01', rows: [] });
    await require('../server/models/MpesaSettings').create({ ispId: String(data.tenants[0]._id), businessName: 'Restore fixture', consumerSecret: 'local-restore-fixture-secret' });
    for (const model of Object.values(mongoose.models)) await model.init();
    const before = await snapshot();
    await run('server/scripts/backup-mongo.js', ['--write', '--dir', directory, '--label', 'restore-drill'], { MONGO_URI: sourceUri });
    const archive = path.join(directory, fs.readdirSync(directory).find(name => name.endsWith('.archive.gz')));
    const migrated = await require('../server/services/mpesaConfigurationService').getMpesaConfig(data.tenants[0]._id);
    assert.ok(migrated, 'Exercise configuration migration after the rollback snapshot');
    await mongoose.disconnect();
    target = await createTestDatabase(); const targetUri = process.env.MONGO_URI;
    assert.notEqual(sourceUri, targetUri);
    await run('server/scripts/restore-mongo.js', ['--write', '--confirm-restore', '--archive', archive], { MONGO_URI: targetUri });
    await mongoose.connect(targetUri);
    assert.deepEqual(await snapshot(), before, 'Restore must preserve all documents and index definitions');
    const report = await require('../server/services/reconciliationService').getReconciliation(data.tenants[0]._id);
    assert.ok(report.ledger.length); assert.ok(report.ledger.every(row => row.difference === 0));
    console.log(JSON.stringify({ result: 'passed', collections: Object.keys(before).length, balances: report.ledger, archive }, null, 2));
  } finally { await mongoose.disconnect(); if (source) await source.stop(); if (target) await target.stop(); }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
