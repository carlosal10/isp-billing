'use strict';

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10000;

function parseShutdownTimeout(value, fallback = DEFAULT_SHUTDOWN_TIMEOUT_MS) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1000 ? Math.floor(parsed) : fallback;
}

function timeoutError(label, timeoutMs) {
  return new Error(`${label} timed out after ${timeoutMs}ms`);
}

function withTimeout(promise, timeoutMs, label = 'operation') {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(timeoutError(label, timeoutMs)), timeoutMs);
    }),
  ]);
}

function closeHttpServer(server, timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS) {
  if (!server || typeof server.close !== 'function') {
    return Promise.resolve({ closed: false, reason: 'missing_server' });
  }
  if (server.listening === false) {
    return Promise.resolve({ closed: false, reason: 'not_listening' });
  }

  if (typeof server.closeIdleConnections === 'function') {
    try {
      server.closeIdleConnections();
    } catch (error) {}
  }

  return withTimeout(
    new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) return reject(error);
        return resolve({ closed: true });
      });
    }),
    timeoutMs,
    'http server close'
  );
}

async function disconnectMongoose(mongooseInstance, timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS) {
  if (!mongooseInstance || typeof mongooseInstance.disconnect !== 'function') {
    return { disconnected: false, reason: 'missing_mongoose' };
  }

  await withTimeout(mongooseInstance.disconnect(), timeoutMs, 'mongoose disconnect');
  return { disconnected: true };
}

async function runShutdownTasks(tasks = [], timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS) {
  const results = [];
  for (const task of tasks) {
    const name = task?.name || 'shutdown-task';
    try {
      await withTimeout(task.run(), task.timeoutMs || timeoutMs, name);
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, error });
    }
  }
  return results;
}

function createProcessLifecycle(options = {}) {
  const logger = options.logger || console;
  const processRef = options.processRef || process;
  const timeoutMs = parseShutdownTimeout(options.timeoutMs);
  const state = {
    shuttingDown: false,
    reason: null,
    startedAt: null,
    completedAt: null,
    error: null,
  };
  let shutdownPromise = null;

  async function shutdown(reason = 'manual', shutdownOptions = {}) {
    if (shutdownPromise) return shutdownPromise;

    state.shuttingDown = true;
    state.reason = reason;
    state.startedAt = new Date();
    logger.info?.('[lifecycle] shutdown starting', { reason });

    shutdownPromise = (async () => {
      const taskResults = await runShutdownTasks(options.shutdownTasks || [], timeoutMs);
      const failedTask = taskResults.find((result) => !result.ok);
      if (failedTask) {
        logger.error?.('[lifecycle] shutdown task failed', {
          task: failedTask.name,
          error: failedTask.error?.message || failedTask.error,
        });
      }

      await closeHttpServer(options.server, timeoutMs);
      await disconnectMongoose(options.mongooseInstance, timeoutMs);

      state.completedAt = new Date();
      logger.info?.('[lifecycle] shutdown complete', { reason });
      return { ok: !failedTask, taskResults };
    })()
      .catch((error) => {
        state.error = error;
        logger.error?.('[lifecycle] shutdown failed', { reason, error: error?.message || error });
        return { ok: false, error };
      })
      .finally(() => {
        if (shutdownOptions.exitAfter) {
          const exitCode = shutdownOptions.exitCode ?? (state.error ? 1 : 0);
          processRef.exit(exitCode);
        }
      });

    return shutdownPromise;
  }

  function installSignalHandlers(signals = ['SIGTERM', 'SIGINT']) {
    signals.forEach((signal) => {
      processRef.once(signal, () => {
        shutdown(signal, { exitAfter: true, exitCode: 0 });
      });
    });
  }

  return {
    installSignalHandlers,
    shutdown,
    state,
  };
}

module.exports = {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  closeHttpServer,
  createProcessLifecycle,
  disconnectMongoose,
  parseShutdownTimeout,
  runShutdownTasks,
  withTimeout,
};
