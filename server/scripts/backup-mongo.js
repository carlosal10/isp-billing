#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
require('dotenv').config();

const {
  buildArchivePath,
  buildMongoDumpArgs,
  deleteBackupFiles,
  formatCommand,
  listBackupArchives,
  parseBackupArgs,
  retentionDeletionPlan,
} = require('../services/backupService');

function main() {
  const options = parseBackupArgs(process.argv.slice(2), process.env);
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error('MONGO_URI or MONGODB_URI is required to create a backup.');
  }

  const archivePath = buildArchivePath(options);
  const args = buildMongoDumpArgs({
    mongoUri,
    archivePath,
    gzip: options.gzip,
  });

  console.log(`[backup] mode=${options.dryRun ? 'dry-run' : 'write'}`);
  console.log(`[backup] archive=${archivePath}`);
  console.log(`[backup] command=${formatCommand(options.toolPath, args)}`);

  if (options.dryRun) {
    console.log('[backup] dry-run only; pass --write to execute mongodump.');
    return;
  }

  fs.mkdirSync(options.backupDir, { recursive: true });
  const result = spawnSync(options.toolPath, args, {
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    return;
  }

  const plan = retentionDeletionPlan(listBackupArchives(options.backupDir), options.keep);
  const removed = deleteBackupFiles(plan.remove, options.backupDir);
  console.log(`[backup] completed archive=${archivePath}`);
  console.log(`[backup] retained=${plan.keep.length} removed=${removed.length}`);
}

try {
  main();
} catch (error) {
  console.error(`[backup] ${error.message}`);
  process.exitCode = 1;
}
