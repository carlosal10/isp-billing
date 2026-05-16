#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
require('dotenv').config();

const mongoose = require('mongoose');
const {
  parseMigrationArgs,
  runMigrations,
} = require('../services/migrationRunnerService');

function summarizePlanItem(item) {
  const marker = item.shouldRun ? 'run' : `skip:${item.skipReason || 'not_required'}`;
  const previous = item.previousStatus ? ` previous=${item.previousStatus}` : '';
  return `- ${item.id} [${marker}]${previous}`;
}

function summarizeResult(item) {
  if (item.skipped) return `- ${item.id} skipped (${item.skipReason})`;
  const status = item.ok ? 'ok' : 'failed';
  return `- ${item.id} ${status} exit=${item.exitCode} durationMs=${item.durationMs}`;
}

async function main() {
  const options = parseMigrationArgs(process.argv.slice(2));
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error('MONGO_URI or MONGODB_URI is required to inspect and run migrations.');
  }

  const mode = options.statusOnly ? 'status' : options.dryRun ? 'dry-run' : 'write';
  console.log(`[migrations] mode=${mode}`);
  if (options.dryRun && !options.statusOnly) {
    console.log('[migrations] dry-run is enabled; pass --write to execute and persist migration status.');
  }

  await mongoose.connect(mongoUri, {
    autoIndex: false,
    serverSelectionTimeoutMS: 10000,
  });

  const result = await runMigrations(options);
  console.log('[migrations] plan');
  result.plan.forEach((item) => console.log(summarizePlanItem(item)));

  if (!options.statusOnly) {
    console.log('[migrations] results');
    result.results.forEach((item) => console.log(summarizeResult(item)));
  }

  const failed = result.results.find((item) => item.ok === false);
  if (failed) {
    if (failed.stderrTail) console.error(failed.stderrTail);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(`[migrations] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
