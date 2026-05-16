'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const SchemaMigration = require('../models/SchemaMigration');
const manifest = require('../migrations/manifest');

const DEFAULT_TAIL_CHARS = 6000;

function parseMigrationArgs(argv = []) {
  const args = Array.isArray(argv) ? argv : [];
  const ids = [];
  let limit = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--id' && args[index + 1]) {
      ids.push(String(args[index + 1]).trim());
      index += 1;
    } else if (arg.startsWith('--id=')) {
      ids.push(String(arg.slice('--id='.length)).trim());
    } else if (arg === '--limit' && args[index + 1]) {
      limit = Number(args[index + 1]);
      index += 1;
    } else if (arg.startsWith('--limit=')) {
      limit = Number(arg.slice('--limit='.length));
    }
  }

  return {
    dryRun: !args.includes('--write'),
    force: args.includes('--force'),
    statusOnly: args.includes('--status'),
    ids: ids.filter(Boolean),
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : null,
  };
}

function tailOutput(value, maxChars = DEFAULT_TAIL_CHARS) {
  const text = String(value || '');
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}

function migrationScriptPath(definition) {
  return path.resolve(__dirname, '..', 'migrations', definition.file);
}

function commandForMigration(definition) {
  return `"${process.execPath}" "${migrationScriptPath(definition)}"`;
}

function normalizeMigrationEnv(baseEnv = process.env, options = {}) {
  const env = { ...baseEnv };
  const mongoUri = env.MONGO_URI || env.MONGODB_URI;
  if (mongoUri) {
    env.MONGO_URI = mongoUri;
    env.MONGODB_URI = mongoUri;
  }
  env.DRY_RUN = options.dryRun ? '1' : '0';
  if (options.limit) env.LIMIT = String(options.limit);
  return env;
}

function filterDefinitions(definitions = manifest, ids = []) {
  if (!ids.length) return definitions;
  const allowed = new Set(ids);
  return definitions.filter((definition) => allowed.has(definition.id));
}

function buildMigrationPlan(definitions = manifest, appliedRows = [], options = {}) {
  const appliedById = new Map(appliedRows.map((row) => [row.id, row]));
  return filterDefinitions(definitions, options.ids || []).map((definition) => {
    const existing = appliedById.get(definition.id) || null;
    const alreadySucceeded = existing?.status === 'succeeded';
    return {
      ...definition,
      command: commandForMigration(definition),
      previousStatus: existing?.status || null,
      lastFinishedAt: existing?.finishedAt || null,
      shouldRun: options.force === true || !alreadySucceeded,
      skipReason: alreadySucceeded && options.force !== true ? 'already_succeeded' : null,
    };
  });
}

async function loadAppliedRows(definitions = manifest) {
  const ids = definitions.map((definition) => definition.id);
  if (!ids.length) return [];
  return SchemaMigration.find({ id: { $in: ids } }).lean();
}

function runMigrationProcess(definition, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [migrationScriptPath(definition)], {
    cwd: path.resolve(__dirname, '..', '..'),
    env: normalizeMigrationEnv(process.env, options),
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 20,
  });

  const durationMs = Date.now() - startedAt;
  const exitCode = typeof result.status === 'number' ? result.status : result.error ? 1 : 0;
  return {
    ok: exitCode === 0,
    exitCode,
    durationMs,
    stdoutTail: tailOutput(result.stdout),
    stderrTail: tailOutput(result.stderr || result.error?.message || ''),
    errorMessage: result.error?.message || (exitCode === 0 ? null : `Migration exited with ${exitCode}`),
  };
}

async function recordMigrationStart(definition, options = {}) {
  if (options.dryRun) return null;
  return SchemaMigration.findOneAndUpdate(
    { id: definition.id },
    {
      $set: {
        description: definition.description || '',
        status: 'running',
        dryRun: false,
        startedAt: new Date(),
        finishedAt: null,
        durationMs: 0,
        exitCode: null,
        command: commandForMigration(definition),
        stdoutTail: null,
        stderrTail: null,
        errorMessage: null,
        runBy: options.runBy || 'migration-runner',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function recordMigrationFinish(definition, result, options = {}) {
  if (options.dryRun) return null;
  return SchemaMigration.findOneAndUpdate(
    { id: definition.id },
    {
      $set: {
        status: result.ok ? 'succeeded' : 'failed',
        dryRun: false,
        finishedAt: new Date(),
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        stdoutTail: result.stdoutTail || null,
        stderrTail: result.stderrTail || null,
        errorMessage: result.errorMessage || null,
      },
    },
    { new: true }
  );
}

async function runMigrations(options = {}) {
  const definitions = filterDefinitions(manifest, options.ids || []);
  const appliedRows = await loadAppliedRows(definitions);
  const plan = buildMigrationPlan(definitions, appliedRows, options);

  if (options.statusOnly) {
    return { dryRun: options.dryRun !== false, statusOnly: true, plan, results: [] };
  }

  const results = [];
  for (const item of plan) {
    if (!item.shouldRun) {
      results.push({ id: item.id, skipped: true, skipReason: item.skipReason });
      continue;
    }

    await recordMigrationStart(item, options);
    const result = runMigrationProcess(item, options);
    await recordMigrationFinish(item, result, options);
    results.push({ id: item.id, ...result });
    if (!result.ok) break;
  }

  return {
    dryRun: options.dryRun !== false,
    statusOnly: false,
    plan,
    results,
  };
}

module.exports = {
  buildMigrationPlan,
  commandForMigration,
  filterDefinitions,
  migrationScriptPath,
  normalizeMigrationEnv,
  parseMigrationArgs,
  runMigrationProcess,
  runMigrations,
  tailOutput,
};
