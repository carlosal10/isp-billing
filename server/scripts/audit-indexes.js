#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
require('dotenv').config();

const mongoose = require('mongoose');
const { auditDeclaredIndexes } = require('../services/indexAuditService');

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI or MONGODB_URI is required to audit indexes.');
  }

  await mongoose.connect(mongoUri, {
    autoIndex: false,
    serverSelectionTimeoutMS: 10000,
  });

  const report = await auditDeclaredIndexes();
  const driftCollections = report.collections.filter(
    (collection) => collection.missing.length > 0 || collection.mismatched.length > 0
  );

  console.log(`[indexes] audited ${report.collections.length} model collections`);
  if (!driftCollections.length) {
    console.log('[indexes] all declared indexes are present and option-compatible');
    return;
  }

  console.log(`[indexes] index drift found in ${driftCollections.length} collections`);
  driftCollections.forEach((collection) => {
    console.log(`- ${collection.modelName} (${collection.collectionName})`);
    collection.missing.forEach((index) => {
      console.log(`  missing ${index.key}`);
    });
    collection.mismatched.forEach((index) => {
      console.log(`  option mismatch ${index.key}`);
      console.log(`    expected ${JSON.stringify(index.expectedOptions)}`);
      console.log(`    actual   ${JSON.stringify(index.actualOptions)}`);
    });
  });
  process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(`[indexes] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
