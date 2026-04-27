'use strict';

const cron = require('node-cron');
const JobRun = require('../models/JobRun');
const JobSchedule = require('../models/JobSchedule');
const { mark } = require('./heartbeats');
const { acquireLock, releaseLock } = require('./jobLock');

const scheduledJobs = new Map();
const activeRuns = new Map();
const DEFAULT_TIMEZONE =
  process.env.JOB_TIMEZONE ||
  process.env.APP_TIMEZONE ||
  process.env.TZ ||
  'Africa/Nairobi';

function jobsEnabledByDefault() {
  return String(process.env.JOBS_ENABLED || 'true').toLowerCase() !== 'false';
}

/**
 * Central scheduler wrapper (cron-based; pluggable to BullMQ later).
 * scheduleJob({
 *   name, cronExpr, task, timezone, noOverlap, enabled, lockTtlMs,
 *   allowManualRun, manualRoles, allowPauseResume, controlRoles
 * })
 */
function scheduleJob({
  name,
  cronExpr,
  task,
  timezone = DEFAULT_TIMEZONE,
  noOverlap = true,
  enabled = jobsEnabledByDefault(),
  lockTtlMs = null,
  allowManualRun = false,
  manualRoles = ['owner', 'admin'],
  allowPauseResume = true,
  controlRoles = null,
}) {
  if (!name || !cronExpr || typeof task !== 'function') {
    throw new Error('Invalid job config');
  }
  if (!enabled) {
    console.log(`[scheduler] skipped ${name} because jobs are disabled`);
    return null;
  }
  if (scheduledJobs.has(name)) {
    console.log(`[scheduler] ${name} already scheduled; skipping duplicate registration`);
    return scheduledJobs.get(name);
  }

  const scheduled = {
    name,
    cronExpr,
    timezone,
    noOverlap,
    lockTtlMs,
    allowManualRun,
    manualRoles: Array.isArray(manualRoles) ? manualRoles : ['owner', 'admin'],
    allowPauseResume: allowPauseResume !== false,
    controlRoles: Array.isArray(controlRoles) && controlRoles.length
      ? controlRoles
      : Array.isArray(manualRoles) && manualRoles.length
        ? manualRoles
        : ['owner', 'admin'],
    taskFn: task,
    task: null,
    paused: false,
    pausedAt: null,
    pausedBy: null,
    pauseReason: null,
    lastResumedAt: null,
    lastResumedBy: null,
    lastManualRunAt: null,
    lastManualRunBy: null,
    lastManualRunRole: null,
    lastManualRunTenantId: null,
    run: (options = {}) => executeScheduledJob(scheduled, options),
  };

  const cronTask = cron.schedule(
    cronExpr,
    async () => scheduled.run({ reason: 'scheduled' }),
    { timezone, noOverlap }
  );

  scheduled.task = cronTask;
  scheduledJobs.set(name, scheduled);
  hydrateScheduledJobState(scheduled).catch(() => {});
  console.log(`[scheduler] scheduled ${name} @ ${cronExpr} tz=${timezone}`);
  return scheduled;
}

function getScheduledJob(name) {
  return scheduledJobs.get(String(name || '')) || null;
}

async function executeScheduledJob(job, options = {}) {
  const reason = options.reason || 'manual';
  const actor = options.actor || null;
  const tenantId = options.tenantId ? String(options.tenantId) : null;

  if (!job) {
    const err = new Error('Job not found');
    err.statusCode = 404;
    throw err;
  }

  if (job.paused === true && reason === 'scheduled') {
    mark(job.name + ':skip-paused');
    console.log(`[scheduler] skipped ${job.name}; job is paused`);
    return { skipped: true, reason: 'paused' };
  }

  if (job.noOverlap && activeRuns.has(job.name)) {
    mark(job.name + ':skip-overlap');
    if (reason === 'manual') {
      const err = new Error('Job is already running');
      err.statusCode = 409;
      throw err;
    }
    console.log(`[scheduler] skipped ${job.name}; run already in progress`);
    return { skipped: true, reason: 'overlap' };
  }

  const execution = (async () => {
    const lockName = `scheduler:${job.name}`;
    let lockAcquired = false;
    let run = null;
    const startedAt = new Date();
    const started = Date.now();

    if (job.lockTtlMs) {
      lockAcquired = await acquireLock(lockName, job.lockTtlMs);
      if (!lockAcquired) {
        mark(job.name + ':skip-lock');
        if (reason === 'manual') {
          const err = new Error('Job is already running on another worker');
          err.statusCode = 409;
          throw err;
        }
        console.log(`[scheduler] skipped ${job.name}; lock held by another runner`);
        return { skipped: true, reason: 'lock' };
      }
    }

    try {
      run = await JobRun.create({
        name: job.name,
        startedAt,
        ok: false,
        trigger: reason,
        triggeredBy: actor?.id || actor?.email || null,
        triggeredRole: actor?.role || null,
        tenantId,
      }).catch(
        () => new JobRun({
          name: job.name,
          startedAt,
          ok: false,
          trigger: reason,
          triggeredBy: actor?.id || actor?.email || null,
          triggeredRole: actor?.role || null,
          tenantId,
        })
      );
      mark(job.name + ':start');
      const stats = await job.taskFn();
      run.ok = true;
      run.stats = stats || null;
      if (reason === 'manual') {
        const now = new Date();
        job.lastManualRunAt = now;
        job.lastManualRunBy = actor?.id || actor?.email || null;
        job.lastManualRunRole = actor?.role || null;
        job.lastManualRunTenantId = tenantId;
        await JobSchedule.findOneAndUpdate(
          { name: job.name },
          {
            $set: {
              lastManualRunAt: now,
              lastManualRunBy: job.lastManualRunBy,
              lastManualRunRole: job.lastManualRunRole,
              lastManualRunTenantId: job.lastManualRunTenantId,
            },
            $setOnInsert: { name: job.name },
          },
          { upsert: true }
        ).catch(() => {});
      }
      return stats || null;
    } catch (e) {
      if (run) {
        run.ok = false;
        run.error = e?.message || String(e);
      }
      if (reason === 'manual') {
        throw e;
      }
      return null;
    } finally {
      if (run) {
        run.finishedAt = new Date();
        await run.save().catch(() => {});
      }
      if (lockAcquired) {
        await releaseLock(lockName).catch(() => {});
      }
      mark(job.name + ':finish');
      const ms = Date.now() - started;
      console.log(`[job] ${job.name} completed in ${ms}ms ok=${run?.ok === true}`);
    }
  })();

  activeRuns.set(job.name, execution);
  try {
    return await execution;
  } finally {
    if (activeRuns.get(job.name) === execution) {
      activeRuns.delete(job.name);
    }
  }
}

async function runScheduledJob(name, options = {}) {
  const job = getScheduledJob(name);
  if (!job) {
    const err = new Error('Job not found');
    err.statusCode = 404;
    throw err;
  }
  if (!job.allowManualRun) {
    const err = new Error('Manual run is not enabled for this job');
    err.statusCode = 403;
    throw err;
  }
  return executeScheduledJob(job, {
    reason: 'manual',
    actor: options.actor || null,
    tenantId: options.tenantId || null,
  });
}

function applyScheduledJobState(job, state = null) {
  job.paused = state?.paused === true;
  job.pausedAt = state?.pausedAt || null;
  job.pausedBy = state?.pausedBy || null;
  job.pauseReason = state?.pauseReason || null;
  job.lastResumedAt = state?.lastResumedAt || null;
  job.lastResumedBy = state?.lastResumedBy || null;
  job.lastManualRunAt = state?.lastManualRunAt || null;
  job.lastManualRunBy = state?.lastManualRunBy || null;
  job.lastManualRunRole = state?.lastManualRunRole || null;
  job.lastManualRunTenantId = state?.lastManualRunTenantId || null;

  if (job.task) {
    const status = typeof job.task.getStatus === 'function' ? job.task.getStatus() : null;
    if (job.paused && status !== 'stopped') {
      job.task.stop();
    } else if (!job.paused && status === 'stopped') {
      job.task.start();
    }
  }
}

async function hydrateScheduledJobState(job) {
  const state = await JobSchedule.findOne({ name: job.name }).lean().catch(() => null);
  applyScheduledJobState(job, state);
  return job;
}

async function syncScheduledJobStates() {
  const names = Array.from(scheduledJobs.keys());
  if (names.length === 0) return [];

  const docs = await JobSchedule.find({ name: { $in: names } }).lean().catch(() => []);
  const byName = new Map(docs.map((doc) => [String(doc.name), doc]));
  for (const job of scheduledJobs.values()) {
    applyScheduledJobState(job, byName.get(job.name) || null);
  }
  return listScheduledJobs();
}

async function setScheduledJobPaused(name, paused, meta = {}) {
  const job = getScheduledJob(name);
  if (!job) {
    const err = new Error('Job not found');
    err.statusCode = 404;
    throw err;
  }
  if (!job.allowPauseResume) {
    const err = new Error('Pause/resume is not enabled for this job');
    err.statusCode = 403;
    throw err;
  }

  const now = new Date();
  const actorId = meta.actor?.id || meta.actor?.email || null;
  const update = paused
    ? {
        $set: {
          paused: true,
          pausedAt: now,
          pausedBy: actorId,
          pauseReason: meta.reason || null,
        },
        $setOnInsert: { name: job.name },
      }
    : {
        $set: {
          paused: false,
          lastResumedAt: now,
          lastResumedBy: actorId,
        },
        $unset: {
          pausedAt: 1,
          pausedBy: 1,
          pauseReason: 1,
        },
        $setOnInsert: { name: job.name },
      };

  const doc = await JobSchedule.findOneAndUpdate(
    { name: job.name },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  applyScheduledJobState(job, doc);
  return job;
}

async function pauseScheduledJob(name, meta = {}) {
  return setScheduledJobPaused(name, true, meta);
}

async function resumeScheduledJob(name, meta = {}) {
  return setScheduledJobPaused(name, false, meta);
}

function listScheduledJobs() {
  return Array.from(scheduledJobs.values()).map((job) => ({
    name: job.name,
    cronExpr: job.cronExpr,
    timezone: job.timezone,
    noOverlap: job.noOverlap,
    lockTtlMs: job.lockTtlMs || null,
    allowManualRun: job.allowManualRun === true,
    manualRoles: Array.isArray(job.manualRoles) ? job.manualRoles : [],
    allowPauseResume: job.allowPauseResume === true,
    controlRoles: Array.isArray(job.controlRoles) ? job.controlRoles : [],
    paused: job.paused === true,
    pausedAt: job.pausedAt || null,
    pausedBy: job.pausedBy || null,
    pauseReason: job.pauseReason || null,
    lastResumedAt: job.lastResumedAt || null,
    lastResumedBy: job.lastResumedBy || null,
    lastManualRunAt: job.lastManualRunAt || null,
    lastManualRunBy: job.lastManualRunBy || null,
    lastManualRunRole: job.lastManualRunRole || null,
    lastManualRunTenantId: job.lastManualRunTenantId || null,
    nextRun: typeof job.task?.getNextRun === 'function' ? job.task.getNextRun() : null,
    status: job.paused === true
      ? 'paused'
      : activeRuns.has(job.name)
      ? 'running'
      : typeof job.task?.getStatus === 'function'
        ? job.task.getStatus()
        : 'unknown',
  }));
}

module.exports = {
  scheduleJob,
  getScheduledJob,
  runScheduledJob,
  pauseScheduledJob,
  resumeScheduledJob,
  syncScheduledJobStates,
  listScheduledJobs,
};
