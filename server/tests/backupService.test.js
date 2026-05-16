'use strict';

const assert = require('assert');
const path = require('path');
const test = require('node:test');

const {
  buildArchivePath,
  buildMongoDumpArgs,
  buildMongoRestoreArgs,
  formatCommand,
  isPathInside,
  parseBackupArgs,
  parseRestoreArgs,
  redactMongoUri,
  retentionDeletionPlan,
  safeLabel,
  timestampForFile,
} = require('../services/backupService');

test('parseBackupArgs defaults to dry-run with safe retention', () => {
  const options = parseBackupArgs([], {});

  assert.equal(options.dryRun, true);
  assert.equal(options.keep, 14);
  assert.equal(options.gzip, true);
  assert.equal(options.label, 'manual');
  assert.equal(options.toolPath, 'mongodump');
});

test('parseBackupArgs accepts write, directory, retention, label, and tool overrides', () => {
  const options = parseBackupArgs(
    ['--write', '--dir', 'tmp/backups', '--keep=5', '--label', 'Nightly Prod', '--mongodump=/bin/dump', '--no-gzip'],
    {}
  );

  assert.equal(options.dryRun, false);
  assert.equal(options.backupDir, path.resolve('tmp/backups'));
  assert.equal(options.keep, 5);
  assert.equal(options.label, 'nightly-prod');
  assert.equal(options.gzip, false);
  assert.equal(options.toolPath, '/bin/dump');
});

test('parseRestoreArgs requires explicit write and confirm flags for execution', () => {
  const options = parseRestoreArgs([
    '--write',
    '--confirm-restore',
    '--drop',
    '--archive=backup.archive.gz',
    '--mongorestore=/bin/restore',
  ]);

  assert.equal(options.dryRun, false);
  assert.equal(options.confirmRestore, true);
  assert.equal(options.drop, true);
  assert.equal(options.archivePath, path.resolve('backup.archive.gz'));
  assert.equal(options.toolPath, '/bin/restore');
});

test('backup archive names are deterministic and filesystem-safe', () => {
  const archivePath = buildArchivePath({
    backupDir: 'backups',
    label: 'Nightly Prod',
    now: new Date('2026-05-13T10:11:12.000Z'),
  });

  assert.equal(
    archivePath,
    path.resolve('backups', 'isp-billing-nightly-prod-20260513T101112Z.archive.gz')
  );
  assert.equal(timestampForFile(new Date('2026-05-13T10:11:12.000Z')), '20260513T101112Z');
  assert.equal(safeLabel('  Main DB / West  '), 'main-db-west');
});

test('mongo tool arguments include archive, gzip, and destructive restore only when requested', () => {
  assert.deepEqual(buildMongoDumpArgs({
    mongoUri: 'mongodb://example/app',
    archivePath: 'backup.archive.gz',
  }), ['--uri', 'mongodb://example/app', '--archive=backup.archive.gz', '--gzip']);

  assert.deepEqual(buildMongoRestoreArgs({
    mongoUri: 'mongodb://example/app',
    archivePath: 'backup.archive.gz',
    drop: true,
  }), ['--uri', 'mongodb://example/app', '--archive=backup.archive.gz', '--gzip', '--drop']);
});

test('formatCommand redacts credentials in MongoDB URIs', () => {
  const command = formatCommand('mongodump', [
    '--uri',
    'mongodb+srv://admin:secret@example.mongodb.net/isp',
    '--archive=backup.archive.gz',
  ]);

  assert.equal(command, 'mongodump --uri mongodb+srv://%3Cuser%3E:%3Cpassword%3E@example.mongodb.net/isp --archive=backup.archive.gz');
  assert.equal(redactMongoUri('mongodb://admin:secret@localhost:27017/isp'), 'mongodb://%3Cuser%3E:%3Cpassword%3E@localhost:27017/isp');
});

test('retentionDeletionPlan keeps newest backups and removes the rest', () => {
  const files = [
    { filePath: 'old.archive.gz', modifiedAt: new Date('2026-01-01T00:00:00Z') },
    { filePath: 'new.archive.gz', modifiedAt: new Date('2026-01-03T00:00:00Z') },
    { filePath: 'mid.archive.gz', modifiedAt: new Date('2026-01-02T00:00:00Z') },
  ];

  const plan = retentionDeletionPlan(files, 2);

  assert.deepEqual(plan.keep.map((file) => file.filePath), ['new.archive.gz', 'mid.archive.gz']);
  assert.deepEqual(plan.remove.map((file) => file.filePath), ['old.archive.gz']);
});

test('isPathInside protects retention deletion scope', () => {
  const root = path.resolve('backups');

  assert.equal(isPathInside(root, path.join(root, 'one.archive.gz')), true);
  assert.equal(isPathInside(root, path.resolve('outside.archive.gz')), false);
});
