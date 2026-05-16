#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
require('dotenv').config();

const {
  buildMongoRestoreArgs,
  formatCommand,
  parseRestoreArgs,
} = require('../services/backupService');

function main() {
  const options = parseRestoreArgs(process.argv.slice(2), process.env);
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error('MONGO_URI or MONGODB_URI is required to restore a backup.');
  }
  if (!options.archivePath) {
    throw new Error('Provide --archive=/absolute/or/relative/path/to/backup.archive.gz.');
  }
  if (!fs.existsSync(options.archivePath)) {
    throw new Error(`Backup archive not found: ${options.archivePath}`);
  }
  if (!options.dryRun && !options.confirmRestore) {
    throw new Error('Restore execution requires --confirm-restore in addition to --write.');
  }

  const args = buildMongoRestoreArgs({
    mongoUri,
    archivePath: options.archivePath,
    gzip: options.gzip,
    drop: options.drop,
  });

  console.log(`[restore] mode=${options.dryRun ? 'dry-run' : 'write'}`);
  console.log(`[restore] archive=${options.archivePath}`);
  console.log(`[restore] drop=${options.drop ? 'yes' : 'no'}`);
  console.log(`[restore] command=${formatCommand(options.toolPath, args)}`);

  if (options.dryRun) {
    console.log('[restore] dry-run only; pass --write --confirm-restore to execute mongorestore.');
    return;
  }

  const result = spawnSync(options.toolPath, args, {
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status || 1;
}

try {
  main();
} catch (error) {
  console.error(`[restore] ${error.message}`);
  process.exitCode = 1;
}
