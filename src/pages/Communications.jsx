import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/apiClient";
import { useAuth } from "../context/AuthContext";

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "-";
}

function formatToken(value) {
  return String(value || "unknown")
    .split(/[-_:]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function statusTone(value) {
  const status = String(value || "").toLowerCase();
  if (["sent", "delivered"].includes(status)) return { background: "#dcfce7", color: "#166534" };
  if (status === "failed") return { background: "#fee2e2", color: "#991b1b" };
  if (status === "skipped") return { background: "#fef3c7", color: "#92400e" };
  return { background: "#dbeafe", color: "#1d4ed8" };
}

function SectionCard({ title, subtitle, actions, children }) {
  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 18,
        padding: 20,
        boxShadow: "0 14px 32px rgba(15, 23, 42, 0.07)",
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
          {subtitle ? <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 14 }}>{subtitle}</p> : null}
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
        boxShadow: "0 12px 28px rgba(15, 23, 42, 0.06)",
      }}
    >
      <div style={{ color: "#64748b", fontSize: 13, fontWeight: 800 }}>{title}</div>
      <div style={{ color: accent || "#0f172a", fontSize: 30, fontWeight: 900, marginTop: 8 }}>{value}</div>
      {hint ? <div style={{ color: "#475569", fontSize: 13, marginTop: 8 }}>{hint}</div> : null}
    </div>
  );
}

function StatusBadge({ value }) {
  const tone = statusTone(value);
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
      {formatToken(value)}
    </span>
  );
}

export default function Communications() {
  const { role, status } = useAuth();
  const canView = role === "owner" || role === "admin";
  const [settings, setSettings] = useState({});
  const [summary, setSummary] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [filters, setFilters] = useState({ status: "", templateType: "", limit: 100 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  const templateOptions = useMemo(() => {
    const values = new Set();
    templates.forEach((template) => {
      if (template.type) values.add(template.type);
    });
    deliveries.forEach((delivery) => {
      if (delivery.templateType) values.add(delivery.templateType);
    });
    return Array.from(values).sort();
  }, [deliveries, templates]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [settingsRes, summaryRes, deliveriesRes, templatesRes] = await Promise.all([
        api.get("/sms/settings").catch(() => ({ data: {} })),
        api.get("/sms/summary", { params: { days: 30 } }),
        api.get("/sms/deliveries", {
          params: {
            limit: filters.limit,
            status: filters.status || undefined,
            templateType: filters.templateType || undefined,
          },
        }),
        api.get("/sms/templates").catch(() => ({ data: [] })),
      ]);
      setSettings(settingsRes.data || {});
      setSummary(summaryRes.data || {});
      setDeliveries(Array.isArray(deliveriesRes.data) ? deliveriesRes.data : []);
      setTemplates(Array.isArray(templatesRes.data) ? templatesRes.data : []);
      setLastUpdatedAt(new Date().toISOString());
    } catch (err) {
      setError(err?.message || "Failed to load communications data");
    } finally {
      setLoading(false);
    }
  }, [filters.limit, filters.status, filters.templateType]);

  useEffect(() => {
    if (status !== "auth" || !canView) return undefined;
    let active = true;
    load().catch((err) => {
      if (active) setError(err?.message || "Failed to load communications data");
    });
    return () => {
      active = false;
    };
  }, [canView, load, status]);

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  if (status === "unknown") return <div style={{ padding: 20 }}>Checking session...</div>;
  if (status !== "auth") return <div style={{ padding: 20 }}>Please log in to view communications.</div>;
  if (!canView) return <div style={{ padding: 20 }}>Communications governance is limited to tenant owners and admins.</div>;

  return (
    <div
      style={{
        minHeight: "100%",
        padding: 20,
        display: "grid",
        gap: 20,
        background: "radial-gradient(circle at top left, #fff7ed 0, transparent 30%), linear-gradient(180deg, #f8fafc 0%, #f1f5f9 46%, #eefbf6 100%)",
      }}
    >
      <header>
        <div style={{ color: "#c2410c", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Communications
        </div>
        <h1 style={{ margin: "6px 0 4px", color: "#0f172a", fontSize: 34 }}>Notification Center</h1>
        <p style={{ margin: 0, color: "#475569", maxWidth: 840 }}>
          Monitor outbound SMS delivery, template coverage, and provider health for billing reminders, paylinks, and customer notices.
        </p>
      </header>

      {error ? <div style={{ color: "#b91c1c", fontWeight: 800 }}>{error}</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 14 }}>
        <SummaryCard
          title="SMS Status"
          value={settings.enabled ? "Enabled" : "Disabled"}
          hint={`Primary provider: ${formatToken(settings.primaryProvider || "not configured")}`}
          accent={settings.enabled ? "#166534" : "#b91c1c"}
        />
        <SummaryCard title="30-Day Sends" value={summary?.total ?? "-"} hint={`${summary?.sent || 0} sent, ${summary?.delivered || 0} delivered`} accent="#1d4ed8" />
        <SummaryCard title="Failures" value={summary?.failed ?? "-"} hint={`${summary?.skipped || 0} skipped or suppressed`} accent={(summary?.failed || 0) > 0 ? "#b91c1c" : "#166534"} />
        <SummaryCard title="Templates" value={templates.length} hint={`${templates.filter((template) => template.active !== false).length} active`} accent="#c2410c" />
      </div>

      <SectionCard
        title="Controls"
        subtitle={lastUpdatedAt ? `Last updated ${formatDateTime(lastUpdatedAt)}` : "Filter delivery history"}
        actions={<button className="btn" onClick={load} disabled={loading}>{loading ? "Refreshing..." : "Refresh"}</button>}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
          <select
            value={filters.status}
            onChange={(event) => updateFilter("status", event.target.value)}
            style={{ padding: "11px 12px", border: "1px solid #cbd5e1", borderRadius: 12 }}
          >
            <option value="">All statuses</option>
            <option value="queued">Queued</option>
            <option value="sent">Sent</option>
            <option value="delivered">Delivered</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
          </select>
          <select
            value={filters.templateType}
            onChange={(event) => updateFilter("templateType", event.target.value)}
            style={{ padding: "11px 12px", border: "1px solid #cbd5e1", borderRadius: 12 }}
          >
            <option value="">All templates</option>
            {templateOptions.map((templateType) => (
              <option key={templateType} value={templateType}>
                {templateType}
              </option>
            ))}
          </select>
          <select
            value={filters.limit}
            onChange={(event) => updateFilter("limit", Number(event.target.value))}
            style={{ padding: "11px 12px", border: "1px solid #cbd5e1", borderRadius: 12 }}
          >
            {[50, 100, 250, 500].map((value) => (
              <option key={value} value={value}>{value} rows</option>
            ))}
          </select>
        </div>
      </SectionCard>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16 }}>
        <SectionCard title="Provider Mix" subtitle="Volume by provider and channel over the last 30 days">
          <div style={{ display: "grid", gap: 10 }}>
            {(summary?.byProvider || []).map((row) => (
              <div
                key={`${row.provider}:${row.channel}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "11px 12px",
                  borderRadius: 12,
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                }}
              >
                <span style={{ fontWeight: 800 }}>{formatToken(row.provider)} / {formatToken(row.channel)}</span>
                <span style={{ color: "#475569" }}>{row.count}</span>
              </div>
            ))}
            {!summary?.byProvider?.length ? <div style={{ color: "#64748b" }}>No provider traffic recorded yet.</div> : null}
          </div>
        </SectionCard>

        <SectionCard title="Recent Failures" subtitle="Fast triage for misconfigured credentials, provider outages, or invalid contacts">
          <div style={{ display: "grid", gap: 10 }}>
            {(summary?.recentFailures || []).map((failure) => (
              <div
                key={failure.id}
                style={{
                  padding: 12,
                  borderRadius: 12,
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                }}
              >
                <strong>{failure.customer?.name || failure.to || "Unknown recipient"}</strong>
                <div style={{ color: "#991b1b", marginTop: 4 }}>{failure.errorMessage || "Delivery failed"}</div>
                <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>{formatDateTime(failure.createdAt)}</div>
              </div>
            ))}
            {!summary?.recentFailures?.length ? <div style={{ color: "#64748b" }}>No recent failures in the selected window.</div> : null}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Delivery Ledger" subtitle={`${deliveries.length} recent outbound SMS delivery record(s)`}>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Status</th>
                <th>Recipient</th>
                <th>Template</th>
                <th>Provider</th>
                <th>Message Preview</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <td>{formatDateTime(delivery.createdAt)}</td>
                  <td><StatusBadge value={delivery.status} /></td>
                  <td>
                    <strong>{delivery.customer?.name || delivery.normalizedTo || "-"}</strong>
                    <div style={{ color: "#64748b", fontSize: 13 }}>{delivery.customer?.accountNumber || delivery.to || "-"}</div>
                  </td>
                  <td>{delivery.templateType || "-"}</td>
                  <td>{formatToken(delivery.provider || "unknown")}</td>
                  <td style={{ maxWidth: 340 }}>{delivery.bodyPreview || "-"}</td>
                  <td style={{ color: delivery.errorMessage ? "#991b1b" : "#64748b" }}>{delivery.errorMessage || "-"}</td>
                </tr>
              ))}
              {!deliveries.length ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 24 }}>
                    {loading ? "Loading deliveries..." : "No delivery records match the current filters."}
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
