'use strict';

const assert = require('assert');
const test = require('node:test');

const {
  closeHttpServer,
  createProcessLifecycle,
  disconnectMongoose,
  parseShutdownTimeout,
  runShutdownTasks,
} = require('../services/processLifecycleService');

function fakeLogger() {
  return {
    info() {},
    error() {},
  };
}

test('parseShutdownTimeout enforces a sensible minimum', () => {
  assert.equal(parseShutdownTimeout('5000'), 5000);
  assert.equal(parseShutdownTimeout('999'), 10000);
  assert.equal(parseShutdownTimeout('nope', 15000), 15000);
});

test('closeHttpServer closes listening servers and ignores missing servers', async () => {
  let closed = false;
  let idleClosed = false;
  const server = {
    listening: true,
    closeIdleConnections() {
      idleClosed = true;
    },
    close(callback) {
      closed = true;
      callback();
    },
  };

  assert.deepEqual(await closeHttpServer(server, 1000), { closed: true });
  assert.equal(closed, true);
  assert.equal(idleClosed, true);
  assert.deepEqual(await closeHttpServer(null, 1000), { closed: false, reason: 'missing_server' });
});

test('disconnectMongoose calls disconnect when available', async () => {
  let disconnected = false;
  const mongooseInstance = {
    async disconnect() {
      disconnected = true;
    },
  };

  assert.deepEqual(await disconnectMongoose(mongooseInstance, 1000), { disconnected: true });
  assert.equal(disconnected, true);
  assert.deepEqual(await disconnectMongoose(null, 1000), { disconnected: false, reason: 'missing_mongoose' });
});

test('runShutdownTasks captures task failures without skipping later tasks', async () => {
  const calls = [];
  const results = await runShutdownTasks([
    { name: 'one', run: async () => calls.push('one') },
    { name: 'two', run: async () => { throw new Error('boom'); } },
    { name: 'three', run: async () => calls.push('three') },
  ], 1000);

  assert.deepEqual(calls, ['one', 'three']);
  assert.deepEqual(results.map((result) => [result.name, result.ok]), [
    ['one', true],
    ['two', false],
    ['three', true],
  ]);
});

test('createProcessLifecycle coordinates idempotent shutdown', async () => {
  let taskRuns = 0;
  let serverClosed = 0;
  let mongoDisconnected = 0;
  const lifecycle = createProcessLifecycle({
    logger: fakeLogger(),
    server: {
      listening: true,
      close(callback) {
        serverClosed += 1;
        callback();
      },
    },
    mongooseInstance: {
      async disconnect() {
        mongoDisconnected += 1;
      },
    },
    shutdownTasks: [
      {
        name: 'pool',
        run: async () => {
          taskRuns += 1;
        },
      },
    ],
    timeoutMs: 1000,
  });

  const first = lifecycle.shutdown('test');
  const second = lifecycle.shutdown('again');
  const result = await first;
  assert.equal(await second, result);
  assert.equal(result.ok, true);
  assert.equal(taskRuns, 1);
  assert.equal(serverClosed, 1);
  assert.equal(mongoDisconnected, 1);
  assert.equal(lifecycle.state.shuttingDown, true);
  assert.equal(lifecycle.state.reason, 'test');
});
