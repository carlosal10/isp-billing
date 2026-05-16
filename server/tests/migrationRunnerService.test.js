'use strict';

const assert = require('assert');
const test = require('node:test');

const {
  buildMigrationPlan,
  filterDefinitions,
  normalizeMigrationEnv,
  parseMigrationArgs,
  tailOutput,
} = require('../services/migrationRunnerService');

const definitions = [
  { id: 'one', file: 'one.js', description: 'First migration' },
  { id: 'two', file: 'two.js', description: 'Second migration' },
];

test('parseMigrationArgs defaults to a safe dry run', () => {
  const options = parseMigrationArgs([]);

  assert.equal(options.dryRun, true);
  assert.equal(options.force, false);
  assert.equal(options.statusOnly, false);
  assert.deepEqual(options.ids, []);
  assert.equal(options.limit, null);
});

test('parseMigrationArgs supports id, write, force, status, and limit flags', () => {
  const options = parseMigrationArgs([
    '--write',
    '--force',
    '--status',
    '--id',
    'one',
    '--id=two',
    '--limit=25',
  ]);

  assert.equal(options.dryRun, false);
  assert.equal(options.force, true);
  assert.equal(options.statusOnly, true);
  assert.deepEqual(options.ids, ['one', 'two']);
  assert.equal(options.limit, 25);
});

test('normalizeMigrationEnv mirrors MONGO_URI aliases and sets dry-run flags', () => {
  const env = normalizeMigrationEnv(
    { MONGODB_URI: 'mongodb://example/test', KEEP_ME: 'yes' },
    { dryRun: false, limit: 50 }
  );

  assert.equal(env.MONGO_URI, 'mongodb://example/test');
  assert.equal(env.MONGODB_URI, 'mongodb://example/test');
  assert.equal(env.DRY_RUN, '0');
  assert.equal(env.LIMIT, '50');
  assert.equal(env.KEEP_ME, 'yes');
});

test('filterDefinitions narrows the migration manifest by id', () => {
  assert.deepEqual(filterDefinitions(definitions, ['two']).map((item) => item.id), ['two']);
});

test('buildMigrationPlan skips successful migrations unless forced', () => {
  const plan = buildMigrationPlan(
    definitions,
    [{ id: 'one', status: 'succeeded', finishedAt: new Date('2026-01-01T00:00:00Z') }],
    {}
  );

  assert.equal(plan[0].shouldRun, false);
  assert.equal(plan[0].skipReason, 'already_succeeded');
  assert.equal(plan[1].shouldRun, true);

  const forced = buildMigrationPlan(definitions, [{ id: 'one', status: 'succeeded' }], { force: true });
  assert.equal(forced[0].shouldRun, true);
  assert.equal(forced[0].skipReason, null);
});

test('tailOutput preserves only the final characters', () => {
  assert.equal(tailOutput('abcdef', 3), 'def');
  assert.equal(tailOutput('abc', 10), 'abc');
});
