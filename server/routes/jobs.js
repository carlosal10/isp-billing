const express = require('express');
const router = express.Router();
const JobRun = require('../models/JobRun');
const JobActionLog = require('../models/JobActionLog');
const requireRole = require('../middleware/requireRole');
const {
  getScheduledJob,
  listScheduledJobs,
  runScheduledJob,
  pauseScheduledJob,
  resumeScheduledJob,
} = require('../utils/scheduler');

function requestActor(req) {
  return {
    id: String(req.user?.email || req.user?.sub || req.user?.id || req.user?._id || ''),
    email: req.user?.email || null,
    role: req.role || (req.user?.isPlatformAdmin ? 'platform-admin' : null),
  };
}

function rolesFor(job, kind) {
  if (kind === 'control') {
    return Array.isArray(job?.controlRoles) && job.controlRoles.length
      ? job.controlRoles
      : ['owner', 'admin'];
  }
  return Array.isArray(job?.manualRoles) && job.manualRoles.length
    ? job.manualRoles
    : ['owner', 'admin'];
}

function canUseJob(req, job, kind) {
  if (req.user?.isPlatformAdmin) return true;
  const callerRole = req.role || null;
  return rolesFor(job, kind).includes(callerRole);
}

async function logAction({ name, action, req, note = null, ok = true, error = null, payload = null }) {
  const actor = requestActor(req);
  return JobActionLog.create({
    name,
    action,
    tenantId: req.tenantId ? String(req.tenantId) : null,
    actor: actor.id || actor.email || null,
    role: actor.role,
    note: note || null,
    ok: ok === true,
    error: error || null,
    payload: payload || null,
  }).catch(() => null);
}

router.get('/jobs/definitions', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const scheduled = listScheduledJobs();
    if (scheduled.length === 0) {
      return res.json([]);
    }

    const names = scheduled.map((job) => job.name);
    const latestRuns = await JobRun.aggregate([
      {
        $match: {
          name: { $in: names },
          $or: [
            { tenantId: req.tenantId ? String(req.tenantId) : null },
            { tenantId: null },
            { tenantId: { $exists: false } },
          ],
        },
      },
      { $sort: { startedAt: -1 } },
      {
        $group: {
          _id: '$name',
          startedAt: { $first: '$startedAt' },
          finishedAt: { $first: '$finishedAt' },
          ok: { $first: '$ok' },
          error: { $first: '$error' },
          trigger: { $first: '$trigger' },
          triggeredBy: { $first: '$triggeredBy' },
          triggeredRole: { $first: '$triggeredRole' },
          tenantId: { $first: '$tenantId' },
        },
      },
    ]);

    const latestByName = new Map(
      latestRuns.map((run) => [
        String(run._id),
        {
          startedAt: run.startedAt || null,
          finishedAt: run.finishedAt || null,
          ok: typeof run.ok === 'boolean' ? run.ok : null,
          error: run.error || null,
          trigger: run.trigger || null,
          triggeredBy: run.triggeredBy || null,
          triggeredRole: run.triggeredRole || null,
          tenantId: run.tenantId || null,
        },
      ])
    );

    res.json(
      scheduled.map((job) => ({
        ...job,
        lastRun: latestByName.get(job.name) || null,
      }))
    );
  } catch (e) {
    res.status(500).json({ error: 'Failed to load scheduled jobs' });
  }
});

router.post('/jobs/:name/run', requireRole('owner', 'admin'), async (req, res) => {
  const name = String(req.params.name || '').trim();
  const note = typeof req.body?.note === 'string'
    ? req.body.note.trim() || null
    : typeof req.body?.reason === 'string'
      ? req.body.reason.trim() || null
      : null;

  try {
    const job = getScheduledJob(name);
    if (!job) {
      return res.status(404).json({ ok: false, error: 'Job not found' });
    }

    if (!job.allowManualRun) {
      return res.status(403).json({ ok: false, error: 'Manual run is not enabled for this job' });
    }

    if (!canUseJob(req, job, 'manual')) {
      return res.status(403).json({ ok: false, error: 'Insufficient role' });
    }

    const stats = await runScheduledJob(name, {
      actor: requestActor(req),
      tenantId: req.tenantId ? String(req.tenantId) : null,
    });

    await logAction({
      name,
      action: 'run',
      req,
      note,
      ok: true,
      payload: { stats: stats || null },
    });

    return res.json({ ok: true, name, stats: stats || null });
  } catch (e) {
    const status = Number(e?.statusCode) || 500;
    await logAction({
      name,
      action: 'run',
      req,
      note,
      ok: false,
      error: e?.message || 'Failed to run job',
    });
    return res.status(status).json({ ok: false, error: e?.message || 'Failed to run job' });
  }
});

router.post('/jobs/:name/pause', requireRole('owner', 'admin'), async (req, res) => {
  const name = String(req.params.name || '').trim();
  const reason = typeof req.body?.reason === 'string'
    ? req.body.reason.trim() || null
    : typeof req.body?.note === 'string'
      ? req.body.note.trim() || null
      : null;

  try {
    const job = getScheduledJob(name);
    if (!job) {
      return res.status(404).json({ ok: false, error: 'Job not found' });
    }

    if (!job.allowPauseResume) {
      return res.status(403).json({ ok: false, error: 'Pause/resume is not enabled for this job' });
    }

    if (!canUseJob(req, job, 'control')) {
      return res.status(403).json({ ok: false, error: 'Insufficient role' });
    }

    const updated = await pauseScheduledJob(name, {
      actor: requestActor(req),
      reason,
    });

    await logAction({
      name,
      action: 'pause',
      req,
      note: reason,
      ok: true,
      payload: {
        paused: updated.paused === true,
        pausedAt: updated.pausedAt || null,
        pausedBy: updated.pausedBy || null,
      },
    });

    return res.json({
      ok: true,
      name,
      paused: updated.paused === true,
      pausedAt: updated.pausedAt || null,
      pausedBy: updated.pausedBy || null,
      pauseReason: updated.pauseReason || null,
    });
  } catch (e) {
    const status = Number(e?.statusCode) || 500;
    await logAction({
      name,
      action: 'pause',
      req,
      note: reason,
      ok: false,
      error: e?.message || 'Failed to pause job',
    });
    return res.status(status).json({ ok: false, error: e?.message || 'Failed to pause job' });
  }
});

router.post('/jobs/:name/resume', requireRole('owner', 'admin'), async (req, res) => {
  const name = String(req.params.name || '').trim();
  const note = typeof req.body?.note === 'string'
    ? req.body.note.trim() || null
    : typeof req.body?.reason === 'string'
      ? req.body.reason.trim() || null
      : null;

  try {
    const job = getScheduledJob(name);
    if (!job) {
      return res.status(404).json({ ok: false, error: 'Job not found' });
    }

    if (!job.allowPauseResume) {
      return res.status(403).json({ ok: false, error: 'Pause/resume is not enabled for this job' });
    }

    if (!canUseJob(req, job, 'control')) {
      return res.status(403).json({ ok: false, error: 'Insufficient role' });
    }

    const updated = await resumeScheduledJob(name, {
      actor: requestActor(req),
      reason: note,
    });

    await logAction({
      name,
      action: 'resume',
      req,
      note,
      ok: true,
      payload: {
        paused: updated.paused === true,
        lastResumedAt: updated.lastResumedAt || null,
        lastResumedBy: updated.lastResumedBy || null,
      },
    });

    return res.json({
      ok: true,
      name,
      paused: updated.paused === true,
      lastResumedAt: updated.lastResumedAt || null,
      lastResumedBy: updated.lastResumedBy || null,
    });
  } catch (e) {
    const status = Number(e?.statusCode) || 500;
    await logAction({
      name,
      action: 'resume',
      req,
      note,
      ok: false,
      error: e?.message || 'Failed to resume job',
    });
    return res.status(status).json({ ok: false, error: e?.message || 'Failed to resume job' });
  }
});

router.get('/jobs/runs', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const q = {};
    if (req.query.name) q.name = String(req.query.name);
    q.$or = [
      { tenantId: req.tenantId ? String(req.tenantId) : null },
      { tenantId: null },
      { tenantId: { $exists: false } },
    ];
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await JobRun.find(q).sort({ startedAt: -1 }).limit(limit).lean();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load job runs' });
  }
});

router.get('/jobs/actions', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const q = { tenantId: req.tenantId ? String(req.tenantId) : null };
    if (req.query.name) q.name = String(req.query.name);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await JobActionLog.find(q).sort({ createdAt: -1 }).limit(limit).lean();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load job actions' });
  }
});

module.exports = router;
