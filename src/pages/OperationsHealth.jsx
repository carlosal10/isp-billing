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
    .split(/[._:-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function statusTone(value) {
  const status = String(value || "").toLowerCase();
  if (["healthy", "up", "sent", "ok"].includes(status)) return { background: "#dcfce7", color: "#166534" };
  if (["watch", "warning", "degraded"].includes(status)) return { background: "#fef3c7", color: "#92400e" };
  if (["critical", "down", "failed"].includes(status)) return { background: "#fee2e2", color: "#991b1b" };
  return { background: "#dbeafe", color: "#1d4ed8" };
}

function severityTone(value) {
  const severity = String(value || "info").toLowerCase();
  if (severity === "critical") return { background: "#fee2e2", color: "#991b1b", border: "#fecaca" };
  if (severity === "warning") return { background: "#fef3c7", color: "#92400e", border: "#fde68a" };
  return { background: "#dbeafe", color: "#1d4ed8", border: "#bfdbfe" };
}

function Pill({ value }) {
  const tone = statusTone(value);
  return (
    <span style={{ display: "inline-flex", borderRadius: 999, padding: "5px 10px", fontWeight: 900, ...tone }}>
      {formatToken(value)}
    </span>
  );
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
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

function metricText(metrics = {}) {
  return Object.entries(metrics)
    .map(([key, value]) => `${formatToken(key)}: ${typeof value === "number" ? value.toLocaleString() : String(value ?? "-")}`)
    .join(" | ");
}

export default function OperationsHealth() {
  const { role, status } = useAuth();
  const canView = role === "owner" || role === "admin";
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/ops-health/summary");
      setHealth(data || null);
    } catch (err) {
      setError(err?.message || "Failed to load operations health");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status !== "auth" || !canView) return undefined;
    let active = true;
    load().catch((err) => {
      if (active) setError(err?.message || "Failed to load operations health");
    });
    return () => {
      active = false;
    };
  }, [canView, load, status]);

  const scoreTone = useMemo(() => {
    const score = Number(health?.score || 0);
    if (score >= 90) return "#166534";
    if (score >= 70) return "#1d4ed8";
    if (score >= 45) return "#b45309";
    return "#b91c1c";
  }, [health?.score]);

  if (status === "unknown") return <div style={{ padding: 20 }}>Checking session...</div>;
  if (status !== "auth") return <div style={{ padding: 20 }}>Please log in to view operations health.</div>;
  if (!canView) return <div style={{ padding: 20 }}>Operations health is limited to tenant owners and admins.</div>;

  return (
    <div
      style={{
        minHeight: "100%",
        padding: 20,
        display: "grid",
        gap: 20,
        background: "radial-gradient(circle at 0% 0%, rgba(14,165,233,.18) 0, transparent 34%), linear-gradient(180deg, #f8fafc 0%, #eef2ff 48%, #ecfeff 100%)",
      }}
    >
      <header>
        <div style={{ color: "#0369a1", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Command Center
        </div>
        <h1 style={{ margin: "6px 0 4px", color: "#0f172a", fontSize: 34 }}>Operations Health</h1>
        <p style={{ margin: 0, color: "#475569", maxWidth: 860 }}>
          A daily risk briefing across routers, billing, payments, jobs, support, incidents, and communications.
        </p>
      </header>

      {error ? <div style={{ color: "#b91c1c", fontWeight: 800 }}>{error}</div> : null}

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
          gap: 16,
          alignItems: "stretch",
        }}
      >
        <div
          style={{
            background: "#0f172a",
            color: "#fff",
            borderRadius: 22,
            padding: 24,
            boxShadow: "0 22px 48px rgba(15,23,42,.22)",
          }}
        >
          <div style={{ color: "#93c5fd", fontWeight: 900, textTransform: "uppercase", letterSpacing: ".08em" }}>Health Score</div>
          <div style={{ color: scoreTone, fontSize: 68, fontWeight: 1000, lineHeight: 1, marginTop: 12 }}>
            {loading && !health ? "..." : health?.score ?? "-"}
          </div>
          <div style={{ marginTop: 12 }}>
            <Pill value={health?.label || "loading"} />
          </div>
          <div style={{ color: "#cbd5e1", marginTop: 14, fontSize: 13 }}>
            Generated {formatDateTime(health?.generatedAt)}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
          {[
            ["Critical", health?.severityCounts?.critical || 0, "#b91c1c"],
            ["Warnings", health?.severityCounts?.warning || 0, "#b45309"],
            ["Info", health?.severityCounts?.info || 0, "#1d4ed8"],
            ["Modules", health?.modules?.length || 0, "#0f172a"],
          ].map(([title, value, color]) => (
            <div key={title} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, padding: 18 }}>
              <div style={{ color: "#64748b", fontSize: 13, fontWeight: 900 }}>{title}</div>
              <div style={{ color, marginTop: 8, fontSize: 34, fontWeight: 1000 }}>{value}</div>
            </div>
          ))}
        </div>
      </section>

      <SectionCard
        title="Subsystems"
        subtitle="Current module posture and key operating metrics."
        actions={<button className="btn" onClick={load} disabled={loading}>{loading ? "Refreshing..." : "Refresh"}</button>}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 12 }}>
          {(health?.modules || []).map((module) => (
            <div
              key={module.key}
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: 16,
                padding: 14,
                background: "#f8fafc",
                display: "grid",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <strong style={{ color: "#0f172a" }}>{module.label}</strong>
                <Pill value={module.status} />
              </div>
              <div style={{ color: "#475569", fontSize: 13, lineHeight: 1.5 }}>
                {metricText(module.metrics)}
              </div>
            </div>
          ))}
          {!health?.modules?.length ? <div style={{ color: "#64748b" }}>{loading ? "Loading modules..." : "No module data available."}</div> : null}
        </div>
      </SectionCard>

      <SectionCard title="Action Queue" subtitle={`${health?.issues?.length || 0} prioritized operational issue(s).`}>
        <div style={{ display: "grid", gap: 12 }}>
          {(health?.issues || []).map((issue) => {
            const tone = severityTone(issue.severity);
            return (
              <div
                key={`${issue.code}:${issue.module}`}
                style={{
                  border: `1px solid ${tone.border}`,
                  background: tone.background,
                  borderRadius: 16,
                  padding: 14,
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ color: tone.color, fontWeight: 1000 }}>{issue.title}</div>
                    <div style={{ color: "#475569", fontSize: 13, marginTop: 3 }}>{formatToken(issue.module)} / {issue.code}</div>
                  </div>
                  <span style={{ color: tone.color, fontWeight: 1000, textTransform: "uppercase", fontSize: 12 }}>{issue.severity}</span>
                </div>
                <div style={{ color: "#334155" }}>{issue.detail}</div>
                <div style={{ color: "#0f172a", fontWeight: 800 }}>Recommended action: {issue.action}</div>
              </div>
            );
          })}
          {!health?.issues?.length ? (
            <div style={{ color: "#166534", fontWeight: 900 }}>
              {loading ? "Loading issue queue..." : "No active operational issues detected. Crisp. Suspiciously crisp, but crisp."}
            </div>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
}
