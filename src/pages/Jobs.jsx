import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/apiClient";
import { useAuth } from "../context/AuthContext";

const REFRESH_MS = 30_000;
const DEFAULT_LIMIT = 50;

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "-";
}

function formatDuration(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) return "-";
  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "-";
  const ms = end - start;
  if (ms < 1000) return `${ms} ms`;
  const seconds = (ms / 1000).toFixed(ms < 10_000 ? 1 : 0);
  return `${seconds} s`;
}

function statusTone(ok) {
  if (ok === true) return { color: "#166534", background: "#dcfce7" };
  if (ok === false) return { color: "#991b1b", background: "#fee2e2" };
  return { color: "#475569", background: "#e2e8f0" };
}

function runtimeTone(status) {
  if (status === "running") return { color: "#92400e", background: "#fef3c7" };
  if (status === "paused") return { color: "#1d4ed8", background: "#dbeafe" };
  if (status === "idle") return { color: "#166534", background: "#dcfce7" };
  if (status === "stopped") return { color: "#991b1b", background: "#fee2e2" };
  return { color: "#475569", background: "#e2e8f0" };
}

function actorLabel(value, role) {
  if (!value && !role) return "-";
  if (value && role) return `${value} (${role})`;
  return value || role || "-";
}

function triggerLabel(run) {
  if (!run?.trigger) return "-";
  return run.trigger === "manual" ? "manual" : "scheduled";
}

async function fetchJobsSnapshot(selectedJob, limit) {
  const params = { limit };
  if (selectedJob) params.name = selectedJob;

  const [definitionsRes, runsRes, actionsRes] = await Promise.all([
    api.get("/jobs/definitions"),
    api.get("/jobs/runs", { params }),
    api.get("/jobs/actions", { params }),
  ]);

  return {
    definitions: Array.isArray(definitionsRes.data) ? definitionsRes.data : [],
    runs: Array.isArray(runsRes.data) ? runsRes.data : [],
    actions: Array.isArray(actionsRes.data) ? actionsRes.data : [],
  };
}

function SectionCard({ title, subtitle, actions, children }) {
  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 16,
        padding: 20,
        boxShadow: "0 12px 30px rgba(15, 23, 42, 0.06)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>{title}</h2>
          {subtitle ? (
            <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 14 }}>{subtitle}</p>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export default function Jobs() {
  const { status, role } = useAuth();
  const [definitions, setDefinitions] = useState([]);
  const [runs, setRuns] = useState([]);
  const [actions, setActions] = useState([]);
  const [selectedJob, setSelectedJob] = useState("");
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [loading, setLoading] = useState({ definitions: true, runs: true, actions: true });
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [busyAction, setBusyAction] = useState("");

  const canOperateJobs = role === "owner" || role === "admin" || role === "platform-admin";

  const canUseJob = (job, kind) => {
    if (!canOperateJobs || !job) return false;
    if (role === "platform-admin") return true;
    const allowedRoles = kind === "control" ? job.controlRoles : job.manualRoles;
    return Array.isArray(allowedRoles) && allowedRoles.length ? allowedRoles.includes(role) : false;
  };

  const applySnapshot = (snapshot) => {
    setDefinitions(snapshot.definitions);
    setRuns(snapshot.runs);
    setActions(snapshot.actions);
    setError("");
    setLastUpdatedAt(new Date().toISOString());
  };

  useEffect(() => {
    if (status !== "auth" || !canOperateJobs) return undefined;

    let active = true;
    let timer = null;

    const load = async (showLoading = false) => {
      if (showLoading) {
        setLoading({ definitions: true, runs: true, actions: true });
      }
      try {
        const snapshot = await fetchJobsSnapshot(selectedJob, limit);
        if (!active) return;
        applySnapshot(snapshot);
      } catch (err) {
        if (!active) return;
        setError(err?.message || "Failed to load job activity");
      } finally {
        if (!active) return;
        setLoading({ definitions: false, runs: false, actions: false });
      }
    };

    load(true);
    timer = window.setInterval(() => {
      load(false);
    }, REFRESH_MS);

    return () => {
      active = false;
      if (timer) window.clearInterval(timer);
    };
  }, [status, selectedJob, limit, canOperateJobs]);

  const summary = useMemo(() => {
    const successCount = runs.filter((run) => run.ok === true).length;
    const failedCount = runs.filter((run) => run.ok === false).length;
    const pausedCount = definitions.filter((job) => job.paused === true).length;
    return {
      definitions: definitions.length,
      successCount,
      failedCount,
      pausedCount,
    };
  }, [definitions, runs]);

  const runJobNow = async (jobName) => {
    if (!jobName) return;
    setBusyAction(`${jobName}:run`);
    setError("");
    try {
      await api.post(`/jobs/${encodeURIComponent(jobName)}/run`, {}, { timeout: 120000 });
      applySnapshot(await fetchJobsSnapshot(selectedJob, limit));
    } catch (err) {
      setError(err?.message || "Failed to run job");
    } finally {
      setBusyAction("");
    }
  };

  const pauseJob = async (jobName) => {
    if (!jobName) return;
    const reason = window.prompt("Pause reason (optional)", "");
    if (reason === null) return;
    setBusyAction(`${jobName}:pause`);
    setError("");
    try {
      await api.post(`/jobs/${encodeURIComponent(jobName)}/pause`, { reason });
      applySnapshot(await fetchJobsSnapshot(selectedJob, limit));
    } catch (err) {
      setError(err?.message || "Failed to pause job");
    } finally {
      setBusyAction("");
    }
  };

  const resumeJob = async (jobName) => {
    if (!jobName) return;
    const confirmed = window.confirm(`Resume ${jobName}?`);
    if (!confirmed) return;
    setBusyAction(`${jobName}:resume`);
    setError("");
    try {
      await api.post(`/jobs/${encodeURIComponent(jobName)}/resume`, {});
      applySnapshot(await fetchJobsSnapshot(selectedJob, limit));
    } catch (err) {
      setError(err?.message || "Failed to resume job");
    } finally {
      setBusyAction("");
    }
  };

  if (status === "unknown") {
    return <div style={{ padding: 16 }}>Checking session...</div>;
  }
  if (status !== "auth") {
    return <div style={{ padding: 16 }}>Please log in to inspect scheduled jobs.</div>;
  }
  if (!canOperateJobs) {
    return <div style={{ padding: 16 }}>Jobs and scheduler controls are limited to tenant owners and admins.</div>;
  }

  return (
    <div
      style={{
        padding: 20,
        display: "grid",
        gap: 20,
        background: "linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)",
        minHeight: "100%",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        <SectionCard title="Registered Jobs">
          <div style={{ fontSize: 30, fontWeight: 700 }}>{summary.definitions}</div>
        </SectionCard>
        <SectionCard title="Paused Jobs">
          <div style={{ fontSize: 30, fontWeight: 700, color: "#1d4ed8" }}>{summary.pausedCount}</div>
        </SectionCard>
        <SectionCard title="Recent Successes">
          <div style={{ fontSize: 30, fontWeight: 700, color: "#166534" }}>{summary.successCount}</div>
        </SectionCard>
        <SectionCard title="Recent Failures">
          <div style={{ fontSize: 30, fontWeight: 700, color: "#991b1b" }}>{summary.failedCount}</div>
        </SectionCard>
      </div>

      <SectionCard
        title="Job Definitions"
        subtitle={`Live scheduler registrations${lastUpdatedAt ? ` | updated ${formatDateTime(lastUpdatedAt)}` : ""}`}
      >
        {error ? <div className="msg-err" role="alert">{error}</div> : null}
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Cron</th>
                <th>Timezone</th>
                <th>Status</th>
                <th>Last Run</th>
                <th>Last Result</th>
                <th>Next Run</th>
                <th>Lock TTL</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {definitions.length > 0 ? (
                definitions.map((job) => {
                  const badge = runtimeTone(job.status);
                  const lastRunBadge = statusTone(job.lastRun?.ok);
                  const canRunManually = job.allowManualRun && canUseJob(job, "manual");
                  const canControl = job.allowPauseResume && canUseJob(job, "control");
                  const isRunning = busyAction === `${job.name}:run`;
                  const isPausing = busyAction === `${job.name}:pause`;
                  const isResuming = busyAction === `${job.name}:resume`;

                  return (
                    <tr key={job.name}>
                      <td>
                        <button
                          type="button"
                          onClick={() => setSelectedJob((current) => (current === job.name ? "" : job.name))}
                          style={{
                            border: "none",
                            background: "none",
                            padding: 0,
                            font: "inherit",
                            color: selectedJob === job.name ? "#1d4ed8" : "#0f172a",
                            cursor: "pointer",
                            fontWeight: 600,
                            textAlign: "left",
                          }}
                        >
                          {job.name}
                        </button>
                        {job.pausedAt ? (
                          <div style={{ marginTop: 6, color: "#64748b", fontSize: 12 }}>
                            paused {formatDateTime(job.pausedAt)}
                          </div>
                        ) : null}
                      </td>
                      <td>{job.cronExpr}</td>
                      <td>{job.timezone || "-"}</td>
                      <td>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "4px 10px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 700,
                            ...badge,
                          }}
                        >
                          {job.status || "unknown"}
                        </span>
                        {job.pauseReason ? (
                          <div style={{ marginTop: 6, color: "#475569", fontSize: 12, maxWidth: 200 }}>
                            {job.pauseReason}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <div>{formatDateTime(job.lastRun?.startedAt)}</div>
                        <div style={{ marginTop: 6, color: "#64748b", fontSize: 12 }}>
                          {triggerLabel(job.lastRun)}
                        </div>
                      </td>
                      <td>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "4px 10px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 700,
                            ...lastRunBadge,
                          }}
                          title={job.lastRun?.error || ""}
                        >
                          {job.lastRun?.ok === true ? "ok" : job.lastRun?.ok === false ? "failed" : "none"}
                        </span>
                        {job.lastRun?.triggeredBy ? (
                          <div style={{ marginTop: 6, color: "#64748b", fontSize: 12 }}>
                            {actorLabel(job.lastRun.triggeredBy, job.lastRun.triggeredRole)}
                          </div>
                        ) : null}
                      </td>
                      <td>{formatDateTime(job.nextRun)}</td>
                      <td>{job.lockTtlMs ? `${Math.round(job.lockTtlMs / 60000)} min` : "None"}</td>
                      <td>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {canRunManually ? (
                            <button
                              type="button"
                              onClick={() => runJobNow(job.name)}
                              disabled={isRunning || job.status === "running"}
                            >
                              {isRunning ? "Running..." : job.status === "running" ? "In Progress" : "Run now"}
                            </button>
                          ) : (
                            <span style={{ color: "#94a3b8", fontSize: 13 }}>
                              {job.allowManualRun ? "Run restricted" : "Manual disabled"}
                            </span>
                          )}
                          {canControl ? (
                            job.paused ? (
                              <button type="button" onClick={() => resumeJob(job.name)} disabled={isResuming}>
                                {isResuming ? "Resuming..." : "Resume"}
                              </button>
                            ) : (
                              <button type="button" onClick={() => pauseJob(job.name)} disabled={isPausing || job.status === "running"}>
                                {isPausing ? "Pausing..." : "Pause"}
                              </button>
                            )
                          ) : (
                            <span style={{ color: "#94a3b8", fontSize: 13 }}>
                              {job.allowPauseResume ? "Control restricted" : "Control disabled"}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center" }}>
                    {loading.definitions ? "Loading definitions..." : "No scheduled jobs registered"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title="Recent Job Runs"
        subtitle={selectedJob ? `Filtered to ${selectedJob}` : "Latest persisted job executions"}
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              Job
              <select value={selectedJob} onChange={(e) => setSelectedJob(e.target.value)}>
                <option value="">All jobs</option>
                {definitions.map((job) => (
                  <option key={job.name} value={job.name}>
                    {job.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              Limit
              <select value={limit} onChange={(e) => setLimit(Number(e.target.value) || DEFAULT_LIMIT)}>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
          </div>
        }
      >
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Trigger</th>
                <th>Actor</th>
                <th>Started</th>
                <th>Finished</th>
                <th>Duration</th>
                <th>Result</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {runs.length > 0 ? (
                runs.map((run) => {
                  const badge = statusTone(run.ok);
                  return (
                    <tr key={run._id}>
                      <td>{run.name}</td>
                      <td>{run.trigger || "scheduled"}</td>
                      <td>{actorLabel(run.triggeredBy, run.triggeredRole)}</td>
                      <td>{formatDateTime(run.startedAt)}</td>
                      <td>{formatDateTime(run.finishedAt)}</td>
                      <td>{formatDuration(run.startedAt, run.finishedAt)}</td>
                      <td>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "4px 10px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 700,
                            ...badge,
                          }}
                        >
                          {run.ok === true ? "ok" : run.ok === false ? "failed" : "pending"}
                        </span>
                      </td>
                      <td style={{ maxWidth: 320, whiteSpace: "normal", color: "#7f1d1d" }}>
                        {run.error || "-"}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center" }}>
                    {loading.runs ? "Loading job runs..." : "No job runs recorded yet"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title="Scheduler Actions"
        subtitle={selectedJob ? `Filtered to ${selectedJob}` : "Manual runs, pauses, and resumes"}
      >
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Name</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Note</th>
                <th>Result</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {actions.length > 0 ? (
                actions.map((action) => {
                  const badge = statusTone(action.ok);
                  return (
                    <tr key={action._id}>
                      <td>{formatDateTime(action.createdAt)}</td>
                      <td>{action.name}</td>
                      <td>{action.action}</td>
                      <td>{actorLabel(action.actor, action.role)}</td>
                      <td style={{ maxWidth: 280, whiteSpace: "normal" }}>{action.note || "-"}</td>
                      <td>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "4px 10px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 700,
                            ...badge,
                          }}
                        >
                          {action.ok === true ? "ok" : "failed"}
                        </span>
                      </td>
                      <td style={{ maxWidth: 320, whiteSpace: "normal", color: "#7f1d1d" }}>
                        {action.error || "-"}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center" }}>
                    {loading.actions ? "Loading scheduler actions..." : "No scheduler actions recorded yet"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
