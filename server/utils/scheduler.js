'use strict';

const cron = require('node-cron');
const JobRun = require('../models/JobRun');
const { mark } = require('./heartbeats');

/**
 * Central scheduler wrapper (cron-based; pluggable to BullMQ later).
 * scheduleJob({ name, cronExpr, task })
 */
function scheduleJob({ name, cronExpr, task }) {
  if (!name || !cronExpr || typeof task !== 'function') throw new Error('Invalid job config');
  cron.schedule(cronExpr, async () => {
    const run = await JobRun.create({ name, startedAt: new Date(), ok: false });
    mark(name + ':start');
    const started = Date.now();
    try {
      const stats = await task();
      run.ok = true;
      run.stats = stats || null;
    } catch (e) {
      run.ok = false;
      run.error = e?.message || String(e);
    } finally {
      run.finishedAt = new Date();
      await run.save().catch(() => {});
      mark(name + ':finish');
      const ms = Date.now() - started;
      console.log(`[job] ${name} completed in ${ms}ms ok=${run.ok}`);
    }
  });
  console.log(`[scheduler] scheduled ${name} @ ${cronExpr}`);
}

module.exports = { scheduleJob };

