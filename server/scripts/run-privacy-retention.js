#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
require('dotenv').config();

const mongoose = require('mongoose');
const { executeRetentionPlan } = require('../services/privacyRetentionService');

function parseArgs(args = []) {
  return {
    dryRun: !args.includes('--write'),
    json: args.includes('--json'),
  };
}

function summarizeCollection(item) {
  const action = item.dryRun ? 'matched' : 'deleted';
  const count = item.dryRun ? item.matchedCount : item.deletedCount;
  return `- ${item.key}: ${action}=${count} cutoff=${item.cutoff.toISOString()} days=${item.days}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error('MONGO_URI or MONGODB_URI is required to run privacy retention.');
  }

  await mongoose.connect(mongoUri, {
    autoIndex: false,
    serverSelectionTimeoutMS: 10000,
  });

  const result = await executeRetentionPlan(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`[privacy-retention] mode=${options.dryRun ? 'dry-run' : 'write'}`);
  if (options.dryRun) {
    console.log('[privacy-retention] dry-run is enabled; pass --write to delete eligible records.');
  }
  result.collections.forEach((item) => console.log(summarizeCollection(item)));
  console.log(`[privacy-retention] totalMatched=${result.totalMatched} totalDeleted=${result.totalDeleted}`);
}

main()
  .catch((error) => {
    console.error(`[privacy-retention] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });

module.exports = { parseArgs, summarizeCollection };
