'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_BACKUP_DIR = path.resolve(__dirname, '..', '..', 'backups', 'mongodb');
const DEFAULT_RETENTION_COUNT = 14;

function readFlagValue(args, flagName) {
  const exactIndex = args.indexOf(flagName);
  if (exactIndex !== -1 && args[exactIndex + 1]) return args[exactIndex + 1];
  const prefix = `${flagName}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function safeLabel(value = 'manual') {
  const cleaned = String(value || 'manual')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'manual';
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function parseBackupArgs(argv = [], env = process.env) {
  const args = Array.isArray(argv) ? argv : [];
  const retentionDefault = positiveInt(env.BACKUP_RETENTION_COUNT, DEFAULT_RETENTION_COUNT);

  return {
    dryRun: !args.includes('--write'),
    backupDir: path.resolve(readFlagValue(args, '--dir') || env.BACKUP_DIR || DEFAULT_BACKUP_DIR),
    keep: positiveInt(readFlagValue(args, '--keep'), retentionDefault),
    label: safeLabel(readFlagValue(args, '--label') || 'manual'),
    gzip: !args.includes('--no-gzip'),
    toolPath: readFlagValue(args, '--mongodump') || env.MONGODUMP_BIN || 'mongodump',
  };
}

function parseRestoreArgs(argv = [], env = process.env) {
  const args = Array.isArray(argv) ? argv : [];
  const archive = readFlagValue(args, '--archive');

  return {
    dryRun: !args.includes('--write'),
    confirmRestore: args.includes('--confirm-restore'),
    drop: args.includes('--drop'),
    gzip: !args.includes('--no-gzip'),
    archivePath: archive ? path.resolve(archive) : null,
    toolPath: readFlagValue(args, '--mongorestore') || env.MONGORESTORE_BIN || 'mongorestore',
  };
}

function buildArchivePath(options = {}) {
  const backupDir = path.resolve(options.backupDir || DEFAULT_BACKUP_DIR);
  const label = safeLabel(options.label || 'manual');
  const stamp = timestampForFile(options.now || new Date());
  const extension = options.gzip === false ? '.archive' : '.archive.gz';
  return path.join(backupDir, `isp-billing-${label}-${stamp}${extension}`);
}

function redactMongoUri(uri = '') {
  const value = String(uri || '');
  if (!value) return '<missing>';

  try {
    const parsed = new URL(value);
    if (parsed.username) parsed.username = '<user>';
    if (parsed.password) parsed.password = '<password>';
    return parsed.toString();
  } catch (error) {
    return value.replace(/\/\/([^/@]+)@/, '//<credentials>@');
  }
}

function buildMongoDumpArgs({ mongoUri, archivePath, gzip = true } = {}) {
  const args = ['--uri', mongoUri, `--archive=${archivePath}`];
  if (gzip) args.push('--gzip');
  return args;
}

function buildMongoRestoreArgs({ mongoUri, archivePath, gzip = true, drop = false } = {}) {
  const args = ['--uri', mongoUri, `--archive=${archivePath}`];
  if (gzip) args.push('--gzip');
  if (drop) args.push('--drop');
  return args;
}

function formatCommand(toolPath, args = []) {
  return [toolPath, ...args].map((arg) => {
    if (String(arg).startsWith('mongodb://') || String(arg).startsWith('mongodb+srv://')) {
      return redactMongoUri(arg);
    }
    return String(arg);
  }).join(' ');
}

function listBackupArchives(backupDir = DEFAULT_BACKUP_DIR) {
  const resolvedDir = path.resolve(backupDir);
  if (!fs.existsSync(resolvedDir)) return [];

  return fs
    .readdirSync(resolvedDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.archive(\.gz)?$/.test(entry.name))
    .map((entry) => {
      const filePath = path.join(resolvedDir, entry.name);
      const stat = fs.statSync(filePath);
      return {
        filePath,
        fileName: entry.name,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime,
      };
    })
    .sort((left, right) => right.modifiedAt.getTime() - left.modifiedAt.getTime());
}

function retentionDeletionPlan(files = [], keep = DEFAULT_RETENTION_COUNT) {
  const keepCount = positiveInt(keep, DEFAULT_RETENTION_COUNT);
  const sorted = [...files].sort(
    (left, right) => new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime()
  );
  return {
    keep: sorted.slice(0, keepCount),
    remove: sorted.slice(keepCount),
  };
}

function isPathInside(parentPath, childPath) {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  const relative = path.relative(parent, child);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function deleteBackupFiles(files = [], backupDir = DEFAULT_BACKUP_DIR) {
  return files.map((file) => {
    if (!isPathInside(backupDir, file.filePath)) {
      throw new Error(`Refusing to delete backup outside backup directory: ${file.filePath}`);
    }
    fs.rmSync(file.filePath, { force: true });
    return file.filePath;
  });
}

module.exports = {
  DEFAULT_BACKUP_DIR,
  DEFAULT_RETENTION_COUNT,
  buildArchivePath,
  buildMongoDumpArgs,
  buildMongoRestoreArgs,
  deleteBackupFiles,
  formatCommand,
  isPathInside,
  listBackupArchives,
  parseBackupArgs,
  parseRestoreArgs,
  positiveInt,
  redactMongoUri,
  retentionDeletionPlan,
  safeLabel,
  timestampForFile,
};
