import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/apiClient";
import { exportRows } from "../lib/exporters";
import { useAuth } from "../context/AuthContext";

const DEFAULT_LIMIT = 50;

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "-";
}

function formatAction(value) {
  return String(value || "unknown")
    .split(/[._:-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function compactPayload(payload) {
  if (!payload) return "-";
  const text = JSON.stringify(payload);
  if (!text || text === "{}") return "-";
  return text.length > 140 ? `${text.slice(0, 140)}...` : text;
}

function toneForAction(action) {
  const value = String(action || "").toLowerCase();
  if (value.includes("fail") || value.includes("error") || value.includes("reverse") || value.includes("refund")) {
    return { background: "#fee2e2", color: "#991b1b" };
  }
  if (value.includes("payment") || value.includes("invoice") || value.includes("finance")) {
    return { background: "#dcfce7", color: "#166534" };
  }
  if (value.includes("queue") || value.includes("job") || value.includes("scheduler")) {
    return { background: "#dbeafe", color: "#1d4ed8" };
  }
  if (value.includes("portal") || value.includes("security")) {
    return { background: "#fef3c7", color: "#92400e" };
  }
  return { background: "#e2e8f0", color: "#475569" };
}

function SectionCard({ title, subtitle, actions, children }) {
  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 18,
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

function SummaryCard({ title, value, hint, accent }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 16,
        padding: 18,
        boxShadow: "0 12px 30px rgba(15, 23, 42, 0.05)",
      }}
    >
      <div style={{ color: "#64748b", fontSize: 13, fontWeight: 800 }}>{title}</div>
      <div style={{ color: accent || "#0f172a", fontSize: 30, fontWeight: 900, marginTop: 8 }}>{value}</div>
      {hint ? <div style={{ color: "#475569", fontSize: 13, marginTop: 8 }}>{hint}</div> : null}
    </div>
  );
}

function ActionBadge({ action }) {
  const tone = toneForAction(action);
  return (
    <span
      style={{
        display: "inline-flex",
        borderRadius: 999,
        padding: "5px 10px",
        fontWeight: 800,
        background: tone.background,
        color: tone.color,
        whiteSpace: "nowrap",
      }}
    >
      {formatAction(action)}
    </span>
  );
}

export default function AuditLogs() {
  const { role, status } = useAuth();
  const canView = role === "owner" || role === "admin" || role === "platform-admin";
  const [logs, setLogs] = useState([]);
  const [actions, setActions] = useState([]);
  const [summary, setSummary] = useState({ total: 0, byAction: [], byActor: [] });
  const [filters, setFilters] = useState({
    q: "",
    action: "",
    actor: "",
    from: "",
    to: "",
  });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  const queryParams = useMemo(() => {
    const params = { page, limit };
    for (const [key, value] of Object.entries(filters)) {
      if (String(value || "").trim()) params[key] = String(value).trim();
    }
    return params;
  }, [filters, limit, page]);

  const loadAuditLogs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [logsRes, actionsRes, summaryRes] = await Promise.all([
        api.get("/audit-logs", { params: queryParams }),
        api.get("/audit-logs/actions", { params: queryParams }),
        api.get("/audit-logs/summary", { params: queryParams }),
      ]);

      setLogs(Array.isArray(logsRes.data?.items) ? logsRes.data.items : []);
      setTotal(Number(logsRes.data?.total || 0));
      setHasMore(Boolean(logsRes.data?.hasMore));
      setActions(Array.isArray(actionsRes.data) ? actionsRes.data : []);
      setSummary(summaryRes.data || { total: 0, byAction: [], byActor: [] });
      setLastUpdatedAt(new Date().toISOString());
    } catch (err) {
      setError(err?.message || "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }, [queryParams]);

  useEffect(() => {
    if (status !== "auth" || !canView) return undefined;
    let active = true;
    loadAuditLogs().catch((err) => {
      if (active) setError(err?.message || "Failed to load audit logs");
    });
    return () => {
      active = false;
    };
  }, [canView, loadAuditLogs, status]);

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
    setExpandedId("");
  };

  const clearFilters = () => {
    setFilters({ q: "", action: "", actor: "", from: "", to: "" });
    setPage(1);
    setExpandedId("");
  };

  const exportCurrentRows = async () => {
    const rows = logs.map((entry) => ({
      Created: formatDateTime(entry.createdAt),
      Actor: entry.actor || "-",
      Action: entry.action || "-",
      "Router Host": entry.routerHost || "-",
      Payload: compactPayload(entry.payload),
    }));
    await exportRows({
      rows,
      headers: ["Created", "Actor", "Action", "Router Host", "Payload"],
      filename: `audit-logs-${new Date().toISOString().slice(0, 10)}`,
      sheetName: "Audit Logs",
    });
  };

  if (status === "unknown") {
    return <div style={{ padding: 16 }}>Checking session...</div>;
  }
  if (status !== "auth") {
    return <div style={{ padding: 16 }}>Please log in to inspect audit logs.</div>;
  }
  if (!canView) {
    return <div style={{ padding: 16 }}>Audit logs are limited to tenant owners and admins.</div>;
  }

  return (
    <div
      style={{
        padding: 20,
        display: "grid",
        gap: 20,
        background: "linear-gradient(180deg, #f8fafc 0%, #f1f5f9 48%, #ecfeff 100%)",
        minHeight: "100%",
      }}
    >
      <header>
        <div style={{ color: "#0f766e", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Governance
        </div>
        <h1 style={{ margin: "6px 0 4px", color: "#0f172a", fontSize: 34 }}>Audit Logs</h1>
        <p style={{ margin: 0, color: "#475569", maxWidth: 820 }}>
          Search tenant activity across billing, jobs, payments, NOC operations, portal access, and network controls.
        </p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 14 }}>
        <SummaryCard title="Matching Events" value={summary.total || total || 0} hint="Filtered activity count" accent="#0f766e" />
        <SummaryCard title="Current Page" value={logs.length} hint={`Page ${page} at ${limit} per page`} />
        <SummaryCard
          title="Top Action"
          value={summary.byAction?.[0]?.count || 0}
          hint={summary.byAction?.[0]?.action ? formatAction(summary.byAction[0].action) : "No action yet"}
          accent="#1d4ed8"
        />
        <SummaryCard
          title="Top Actor"
          value={summary.byActor?.[0]?.count || 0}
          hint={summary.byActor?.[0]?.actor || "No actor yet"}
          accent="#92400e"
        />
      </div>

      <SectionCard
        title="Filters"
        subtitle={lastUpdatedAt ? `Last updated ${formatDateTime(lastUpdatedAt)}` : "Load and refine tenant activity"}
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" onClick={loadAuditLogs} disabled={loading}>
              Refresh
            </button>
            <button className="btn" onClick={exportCurrentRows} disabled={!logs.length}>
              Export
            </button>
            <button className="btn" style={{ background: "#64748b" }} onClick={clearFilters}>
              Clear
            </button>
          </div>
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
          <input
            value={filters.q}
            onChange={(event) => updateFilter("q", event.target.value)}
            placeholder="Search actor, action, ids, reason..."
            style={{ padding: "11px 12px", border: "1px solid #cbd5e1", borderRadius: 12 }}
          />
          <select
            value={filters.action}
            onChange={(event) => updateFilter("action", event.target.value)}
            style={{ padding: "11px 12px", border: "1px solid #cbd5e1", borderRadius: 12 }}
          >
            <option value="">All actions</option>
            {actions.map((item) => (
              <option key={item.action} value={item.action}>
                {formatAction(item.action)} ({item.count})
              </option>
            ))}
          </select>
          <input
            value={filters.actor}
            onChange={(event) => updateFilter("actor", event.target.value)}
            placeholder="Actor email or id"
            style={{ padding: "11px 12px", border: "1px solid #cbd5e1", borderRadius: 12 }}
          />
          <input
            type="date"
            value={filters.from}
            onChange={(event) => updateFilter("from", event.target.value)}
            style={{ padding: "11px 12px", border: "1px solid #cbd5e1", borderRadius: 12 }}
          />
          <input
            type="date"
            value={filters.to}
            onChange={(event) => updateFilter("to", event.target.value)}
            style={{ padding: "11px 12px", border: "1px solid #cbd5e1", borderRadius: 12 }}
          />
          <select
            value={limit}
            onChange={(event) => {
              setLimit(Number(event.target.value));
              setPage(1);
            }}
            style={{ padding: "11px 12px", border: "1px solid #cbd5e1", borderRadius: 12 }}
          >
            {[25, 50, 100, 250].map((value) => (
              <option key={value} value={value}>
                {value} per page
              </option>
            ))}
          </select>
        </div>
      </SectionCard>

      <SectionCard
        title="Activity Timeline"
        subtitle={`${total.toLocaleString()} matching event(s)`}
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="btn" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>
              Previous
            </button>
            <span style={{ color: "#475569", fontWeight: 800 }}>Page {page}</span>
            <button className="btn" disabled={!hasMore || loading} onClick={() => setPage((value) => value + 1)}>
              Next
            </button>
          </div>
        }
      >
        {error ? <div style={{ color: "#b91c1c", marginBottom: 12 }}>{error}</div> : null}
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Router</th>
                <th>Payload</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {logs.map((entry) => {
                const expanded = expandedId === entry._id;
                return (
                  <React.Fragment key={entry._id}>
                    <tr>
                      <td>{formatDateTime(entry.createdAt)}</td>
                      <td>{entry.actor || "-"}</td>
                      <td><ActionBadge action={entry.action} /></td>
                      <td>{entry.routerHost || "-"}</td>
                      <td>{compactPayload(entry.payload)}</td>
                      <td>
                        <button className="btn" onClick={() => setExpandedId(expanded ? "" : entry._id)}>
                          {expanded ? "Hide" : "Details"}
                        </button>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr>
                        <td colSpan={6}>
                          <pre
                            style={{
                              whiteSpace: "pre-wrap",
                              margin: 0,
                              padding: 14,
                              borderRadius: 12,
                              background: "#0f172a",
                              color: "#e2e8f0",
                              maxHeight: 360,
                              overflow: "auto",
                            }}
                          >
                            {JSON.stringify(entry, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
              {!logs.length ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: 24 }}>
                    {loading ? "Loading audit logs..." : "No audit events match the current filters."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
