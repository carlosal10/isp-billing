'use strict';

const { scheduleJob } = require('./scheduler');
const { sendCommand } = require('./mikrotikConnectionManager');
const JobRun = require('../models/JobRun');
const { mark } = require('./heartbeats');

/**
 * Schedule a MikroTik polling job safely.
 * @param {Object} config
 * @param {string} config.name - Unique job name
 * @param {string} config.cronExpr - Cron expression
 * @param {Object} config.router - { tenantId, host?, serverId?, serverName?, port? }
 * @param {string} config.path - RouterOS command path
 * @param {Array} config.args - RouterOS command arguments
 */
function scheduleMikroTikPoll({ name, cronExpr, router, path, args = [] }) {
  scheduleJob({
    name,
    cronExpr,
    task: async () => {
      const run = await JobRun.create({ name, startedAt: new Date(), ok: false });
      mark(name + ':start');
      const startMs = Date.now();
      try {
        const res = await sendCommand(path, args, router);
        run.ok = true;
        run.stats = { rows: Array.isArray(res) ? res.length : 0 };
        return run.stats;
      } catch (err) {
        run.ok = false;
        run.error = String(err.message || err);
        console.error(`[MT poll] ${name} failed:`, run.error);
        throw err; // propagate so cron logging still sees failure
      } finally {
        run.finishedAt = new Date();
        await run.save().catch(() => {});
        mark(name + ':finish');
        const dur = Date.now() - startMs;
        console.log(`[MT poll] ${name} completed in ${dur}ms ok=${run.ok}`);
      }
    }
  });
}

module.exports = { scheduleMikroTikPoll };
