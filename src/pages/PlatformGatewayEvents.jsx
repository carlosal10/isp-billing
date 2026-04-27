import React, { useEffect, useMemo, useState } from "react";
import { platformApi } from "../lib/apiClient";
import { useAuth } from "../context/AuthContext";

const DEFAULT_FILTERS = {
  provider: "",
  kind: "",
  eventStatus: "",
  claimState: "all",
  sort: "oldest",
  limit: "50",
};

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "-";
}

function formatTokenLabel(value) {
  return String(value || "")
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatJsonBlock(value) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function statusTone(status) {
  switch (String(status || "").toLowerCase()) {
    case "processed":
      return { color: "#166534", background: "#dcfce7" };
    case "unmatched":
      return { color: "#92400e", background: "#fef3c7" };
    case "failed":
    case "rejected":
      return { color: "#991b1b", background: "#fee2e2" };
    case "processing":
    case "received":
      return { color: "#1d4ed8", background: "#dbeafe" };
    default:
      return { color: "#475569", background: "#e2e8f0" };
  }
}

function getResolutionTargetType(event) {
  const provider = String(event?.provider || "").toLowerCase();
  const kind = String(event?.kind || "").toLowerCase();
  if (
    (provider === "mpesa" && kind === "stk-callback") ||
    (provider === "stripe" && kind === "webhook")
  ) {
    return "payment";
  }
  if (provider === "mpesa" && kind === "c2b-confirmation") {
    return "customer";
  }
  return null;
}

function ageLabel(event) {
  const hours = Number(event?.queueAgeHours);
  if (!Number.isFinite(hours)) return "-";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m old`;
  if (hours < 24) return `${hours.toFixed(hours < 10 ? 1 : 0)}h old`;
  const days = hours / 24;
  return `${days.toFixed(days < 10 ? 1 : 0)}d old`;
}

function queueOwnerLabel(event) {
  return event?.queueOwnerDisplay || event?.queueOwner || "Unclaimed";
}

function SectionCard({ title, subtitle, actions, children }) {
  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 18,
        padding: 20,
        boxShadow: "0 16px 36px rgba(15, 23, 42, 0.06)",
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

export default function PlatformGatewayEvents() {
  const { isPlatformAdmin, status, user } = useAuth();
  const currentActorId = user?.email || user?.id || user?.username || "";

  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [summary, setSummary] = useState({
    total: 0,
    claimed: 0,
    unclaimed: 0,
    stale24h: 0,
    stale72h: 0,
    byStatus: {},
    byProvider: {},
  });
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [actionHistory, setActionHistory] = useState([]);

  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");

  const [tenantQuery, setTenantQuery] = useState("");
  const [tenantResults, setTenantResults] = useState([]);
  const [tenantLoading, setTenantLoading] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [actionNote, setActionNote] = useState("");

  const [resolutionQuery, setResolutionQuery] = useState("");
  const [resolutionResults, setResolutionResults] = useState([]);
  const [resolutionLoading, setResolutionLoading] = useState(false);
  const [selectedResolution, setSelectedResolution] = useState(null);

  const resolutionType = useMemo(
    () => getResolutionTargetType(selectedEvent),
    [selectedEvent]
  );
  const claimedByMe =
    Boolean(selectedEvent?.queueOwner) && selectedEvent.queueOwner === currentActorId;
  const blockedByAnotherOperator =
    Boolean(selectedEvent?.queueOwner) && selectedEvent.queueOwner !== currentActorId;

  const fetchSummaryAndEvents = async (nextFilters = filters) => {
    setLoading(true);
    setError("");
    try {
      const params = {
        provider: nextFilters.provider || undefined,
        kind: nextFilters.kind || undefined,
        eventStatus: nextFilters.eventStatus || undefined,
        claimState: nextFilters.claimState || undefined,
        sort: nextFilters.sort || undefined,
        limit: nextFilters.limit || DEFAULT_FILTERS.limit,
      };

      const [summaryRes, eventsRes] = await Promise.all([
        platformApi.get("/gateway-events/orphans/summary", { params }),
        platformApi.get("/gateway-events/orphans", { params }),
      ]);

      const nextEvents = Array.isArray(eventsRes.data) ? eventsRes.data : [];
      setSummary(summaryRes.data || {});
      setEvents(nextEvents);
      setSelectedEventId((current) =>
        current && nextEvents.some((event) => event._id === current)
          ? current
          : nextEvents[0]?._id || null
      );
    } catch (err) {
      setSummary({
        total: 0,
        claimed: 0,
        unclaimed: 0,
        stale24h: 0,
        stale72h: 0,
        byStatus: {},
        byProvider: {},
      });
      setEvents([]);
      setSelectedEventId(null);
      setError(err?.message || "Failed to load orphan gateway queue");
    } finally {
      setLoading(false);
    }
  };

  const openEvent = async (eventId) => {
    if (!eventId) {
      setSelectedEvent(null);
      setActionHistory([]);
      return;
    }

    setDetailLoading(true);
    setHistoryLoading(true);
    try {
      const [detailRes, actionsRes] = await Promise.all([
        platformApi.get(`/gateway-events/orphans/${eventId}`),
        platformApi.get(`/gateway-events/orphans/${eventId}/actions`),
      ]);
      setSelectedEvent(detailRes.data || null);
      setActionHistory(Array.isArray(actionsRes.data) ? actionsRes.data : []);
      setError("");
    } catch (err) {
      setSelectedEvent(null);
      setActionHistory([]);
      setError(err?.message || "Failed to load orphan gateway event detail");
    } finally {
      setDetailLoading(false);
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (status !== "auth" || !isPlatformAdmin) return;
    fetchSummaryAndEvents(DEFAULT_FILTERS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, isPlatformAdmin]);

  useEffect(() => {
    if (!selectedEventId) {
      setSelectedEvent(null);
      setActionHistory([]);
      return;
    }
    openEvent(selectedEventId);
  }, [selectedEventId]);

  useEffect(() => {
    if (!selectedEvent) {
      setTenantQuery("");
      setTenantResults([]);
      setSelectedTenant(null);
      setActionNote("");
      setResolutionQuery("");
      setResolutionResults([]);
      setSelectedResolution(null);
      return;
    }

    setTenantQuery("");
    setTenantResults([]);
    setSelectedTenant(null);
    setActionNote("");
    setSelectedResolution(null);
    setResolutionResults([]);
    setResolutionQuery(
      selectedEvent.accountNumber ||
        selectedEvent.phoneNumber ||
        selectedEvent.externalRef ||
        ""
    );
  }, [selectedEvent]);

  useEffect(() => {
    if (!tenantQuery.trim()) {
      setTenantResults([]);
      return undefined;
    }

    let active = true;
    setTenantLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const { data } = await platformApi.get("/gateway-events/tenants/search", {
          params: { query: tenantQuery.trim() },
        });
        if (!active) return;
        setTenantResults(Array.isArray(data) ? data : []);
      } catch {
        if (!active) return;
        setTenantResults([]);
      } finally {
        if (active) setTenantLoading(false);
      }
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [tenantQuery]);

  useEffect(() => {
    if (!selectedTenant?._id || !resolutionType || !resolutionQuery.trim()) {
      setResolutionResults([]);
      return undefined;
    }

    let active = true;
    setResolutionLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const endpoint =
          resolutionType === "payment"
            ? `/gateway-events/tenants/${selectedTenant._id}/payments/search`
            : `/gateway-events/tenants/${selectedTenant._id}/customers/search`;
        const params = { query: resolutionQuery.trim() };
        if (resolutionType === "payment" && selectedEvent?.provider) {
          params.provider = selectedEvent.provider;
        }
        const { data } = await platformApi.get(endpoint, { params });
        if (!active) return;
        setResolutionResults(Array.isArray(data) ? data : []);
      } catch {
        if (!active) return;
        setResolutionResults([]);
      } finally {
        if (active) setResolutionLoading(false);
      }
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [resolutionQuery, resolutionType, selectedEvent?.provider, selectedTenant]);

  useEffect(() => {
    if (!actionMessage) return undefined;
    const timer = window.setTimeout(() => setActionMessage(""), 3500);
    return () => window.clearTimeout(timer);
  }, [actionMessage]);

  const performEventAction = async ({
    type,
    endpoint,
    body = {},
    successMessage,
    preserveSelection = true,
  }) => {
    if (!selectedEvent?._id) return;
    setBusyAction(type);
    setError("");
    try {
      await platformApi.post(endpoint, body);
      setActionMessage(successMessage);
      await fetchSummaryAndEvents(filters);
      if (preserveSelection) {
        await openEvent(selectedEvent._id);
      } else {
        setSelectedEvent(null);
        setSelectedEventId(null);
      }
    } catch (err) {
      setError(err?.message || "Gateway event action failed");
    } finally {
      setBusyAction("");
    }
  };

  const handleClaim = async () => {
    if (!selectedEvent?._id) return;
    await performEventAction({
      type: "claim",
      endpoint: `/gateway-events/orphans/${selectedEvent._id}/claim`,
      body: { note: actionNote || undefined },
      successMessage: "Queue claim saved.",
    });
  };

  const handleRelease = async () => {
    if (!selectedEvent?._id) return;
    await performEventAction({
      type: "release",
      endpoint: `/gateway-events/orphans/${selectedEvent._id}/release`,
      body: { note: actionNote || undefined },
      successMessage: "Queue claim released.",
    });
  };

  const handleAdopt = async () => {
    if (!selectedTenant?._id) return;
    await performEventAction({
      type: "adopt",
      endpoint: `/gateway-events/orphans/${selectedEvent._id}/adopt`,
      body: { tenantId: selectedTenant._id, note: actionNote || undefined },
      successMessage: `Adopted orphan event into ${selectedTenant.name}.`,
      preserveSelection: false,
    });
  };

  const handleRetry = async () => {
    if (!selectedTenant?._id) return;
    await performEventAction({
      type: "retry",
      endpoint: `/gateway-events/orphans/${selectedEvent._id}/retry`,
      body: { tenantId: selectedTenant._id, note: actionNote || undefined },
      successMessage: `Retried orphan event in ${selectedTenant.name}.`,
      preserveSelection: false,
    });
  };

  const handleResolve = async () => {
    if (!selectedTenant?._id || !selectedResolution?._id || !resolutionType) return;
    await performEventAction({
      type: "resolve",
      endpoint: `/gateway-events/orphans/${selectedEvent._id}/resolve`,
      body: {
        tenantId: selectedTenant._id,
        note: actionNote || undefined,
        paymentId: resolutionType === "payment" ? selectedResolution._id : undefined,
        customerId: resolutionType === "customer" ? selectedResolution._id : undefined,
      },
      successMessage: `Resolved orphan event in ${selectedTenant.name}.`,
      preserveSelection: false,
    });
  };

  const providerSummary = Object.entries(summary.byProvider || {});
  const statusSummary = Object.entries(summary.byStatus || {});

  if (status === "unknown") {
    return <div style={{ padding: 20 }}>Checking platform session...</div>;
  }

  if (!isPlatformAdmin) {
    return (
      <div style={{ padding: 20 }}>
        Platform orphan queue access is limited to platform-admin sessions.
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100%",
        padding: 20,
        display: "grid",
        gap: 20,
        background:
          "linear-gradient(180deg, #f8fafc 0%, #eff6ff 54%, #f8fafc 100%)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        <SectionCard title="Queue Size">
          <div style={{ fontSize: 30, fontWeight: 700 }}>{summary.total || 0}</div>
        </SectionCard>
        <SectionCard title="Claimed">
          <div style={{ fontSize: 30, fontWeight: 700, color: "#0f766e" }}>
            {summary.claimed || 0}
          </div>
        </SectionCard>
        <SectionCard title="Over 24h">
          <div style={{ fontSize: 30, fontWeight: 700, color: "#b45309" }}>
            {summary.stale24h || 0}
          </div>
        </SectionCard>
        <SectionCard title="Over 72h">
          <div style={{ fontSize: 30, fontWeight: 700, color: "#991b1b" }}>
            {summary.stale72h || 0}
          </div>
        </SectionCard>
      </div>

      {providerSummary.length || statusSummary.length ? (
        <SectionCard
          title="Queue Signals"
          subtitle="Filter-aware counts to help triage by provider, status, and age."
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 16,
            }}
          >
            <div>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>By Provider</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {providerSummary.length ? (
                  providerSummary.map(([key, count]) => (
                    <span
                      key={key}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 999,
                        background: "#eef2ff",
                        color: "#3730a3",
                        fontWeight: 700,
                        fontSize: 13,
                      }}
                    >
                      {formatTokenLabel(key)}: {count}
                    </span>
                  ))
                ) : (
                  <span style={{ color: "#64748b" }}>No provider data.</span>
                )}
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>By Status</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {statusSummary.length ? (
                  statusSummary.map(([key, count]) => {
                    const tone = statusTone(key);
                    return (
                      <span
                        key={key}
                        style={{
                          ...tone,
                          padding: "6px 10px",
                          borderRadius: 999,
                          fontWeight: 700,
                          fontSize: 13,
                        }}
                      >
                        {formatTokenLabel(key)}: {count}
                      </span>
                    );
                  })
                ) : (
                  <span style={{ color: "#64748b" }}>No status data.</span>
                )}
              </div>
            </div>
          </div>
        </SectionCard>
      ) : null}

      {error ? (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            background: "#fee2e2",
            color: "#991b1b",
            border: "1px solid #fecaca",
          }}
        >
          {error}
        </div>
      ) : null}

      {actionMessage ? (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            background: "#dcfce7",
            color: "#166534",
            border: "1px solid #bbf7d0",
          }}
        >
          {actionMessage}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(360px, 1fr) minmax(440px, 1.25fr)",
          gap: 20,
          alignItems: "start",
        }}
      >
        <SectionCard
          title="Orphan Queue"
          subtitle="Claim, filter, and triage tenantless gateway receipts."
          actions={
            <button
              type="button"
              onClick={() => fetchSummaryAndEvents(filters)}
              style={{
                border: "1px solid #cbd5e1",
                background: "#fff",
                borderRadius: 12,
                padding: "10px 14px",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              Refresh
            </button>
          }
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <select
              value={filters.provider}
              onChange={(e) =>
                setFilters((current) => ({ ...current, provider: e.target.value }))
              }
              style={{ padding: 10, borderRadius: 10, border: "1px solid #cbd5e1" }}
            >
              <option value="">All providers</option>
              <option value="stripe">Stripe</option>
              <option value="mpesa">M-Pesa</option>
            </select>
            <select
              value={filters.kind}
              onChange={(e) =>
                setFilters((current) => ({ ...current, kind: e.target.value }))
              }
              style={{ padding: 10, borderRadius: 10, border: "1px solid #cbd5e1" }}
            >
              <option value="">All kinds</option>
              <option value="webhook">Webhook</option>
              <option value="c2b-confirmation">C2B confirmation</option>
              <option value="stk-callback">STK callback</option>
            </select>
            <select
              value={filters.eventStatus}
              onChange={(e) =>
                setFilters((current) => ({
                  ...current,
                  eventStatus: e.target.value,
                }))
              }
              style={{ padding: 10, borderRadius: 10, border: "1px solid #cbd5e1" }}
            >
              <option value="">All statuses</option>
              <option value="rejected">Rejected</option>
              <option value="failed">Failed</option>
              <option value="unmatched">Unmatched</option>
            </select>
            <select
              value={filters.claimState}
              onChange={(e) =>
                setFilters((current) => ({
                  ...current,
                  claimState: e.target.value,
                }))
              }
              style={{ padding: 10, borderRadius: 10, border: "1px solid #cbd5e1" }}
            >
              <option value="all">All claims</option>
              <option value="unclaimed">Unclaimed</option>
              <option value="claimed">Claimed</option>
              <option value="mine">Mine</option>
            </select>
            <select
              value={filters.sort}
              onChange={(e) =>
                setFilters((current) => ({ ...current, sort: e.target.value }))
              }
              style={{ padding: 10, borderRadius: 10, border: "1px solid #cbd5e1" }}
            >
              <option value="oldest">Oldest first</option>
              <option value="newest">Newest first</option>
            </select>
            <button
              type="button"
              onClick={() => fetchSummaryAndEvents(filters)}
              style={{
                border: "none",
                background: "#0f172a",
                color: "#fff",
                borderRadius: 10,
                padding: "10px 14px",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              Apply
            </button>
          </div>

          {loading ? (
            <div style={{ padding: "12px 0", color: "#64748b" }}>
              Loading orphan queue...
            </div>
          ) : events.length === 0 ? (
            <div style={{ padding: "12px 0", color: "#64748b" }}>
              No orphan gateway events match the current filters.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {events.map((event) => {
                const isSelected = selectedEventId === event._id;
                const tone = statusTone(event.eventStatus);
                const isMine = event.queueOwner && event.queueOwner === currentActorId;
                return (
                  <button
                    key={event._id}
                    type="button"
                    onClick={() => setSelectedEventId(event._id)}
                    style={{
                      textAlign: "left",
                      border: isSelected ? "1px solid #2563eb" : "1px solid #e2e8f0",
                      borderRadius: 14,
                      padding: 14,
                      background: isSelected ? "#eff6ff" : "#fff",
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>
                        {formatTokenLabel(event.provider)} · {formatTokenLabel(event.kind)}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <span
                          style={{
                            ...tone,
                            padding: "4px 10px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          {formatTokenLabel(event.eventStatus)}
                        </span>
                        <span
                          style={{
                            padding: "4px 10px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 700,
                            background: isMine ? "#dbeafe" : "#f1f5f9",
                            color: isMine ? "#1d4ed8" : "#475569",
                          }}
                        >
                          {queueOwnerLabel(event)}
                        </span>
                      </div>
                    </div>
                    <div style={{ marginTop: 8, color: "#475569", fontSize: 14 }}>
                      {event.accountNumber ||
                        event.phoneNumber ||
                        event.externalRef ||
                        "No account hint"}
                    </div>
                    <div
                      style={{
                        marginTop: 8,
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        color: "#64748b",
                        fontSize: 12,
                        flexWrap: "wrap",
                      }}
                    >
                      <span>{event.externalId || event.transactionId || "-"}</span>
                      <span>{ageLabel(event)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Resolution Workspace"
          subtitle="Inspect the raw receipt, coordinate ownership, and complete recovery safely."
        >
          {!selectedEventId ? (
            <div style={{ color: "#64748b" }}>
              Select an orphan event from the queue to begin.
            </div>
          ) : detailLoading ? (
            <div style={{ color: "#64748b" }}>Loading event detail...</div>
          ) : !selectedEvent ? (
            <div style={{ color: "#64748b" }}>
              This event is no longer available in the orphan queue.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 18 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div style={{ fontSize: 22, fontWeight: 800 }}>
                    {formatTokenLabel(selectedEvent.provider)}{" "}
                    {formatTokenLabel(selectedEvent.kind)}
                  </div>
                  <div style={{ marginTop: 6, color: "#64748b" }}>
                    Received {formatDateTime(selectedEvent.createdAt || selectedEvent.firstSeenAt)} ·{" "}
                    {ageLabel(selectedEvent)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span
                    style={{
                      ...statusTone(selectedEvent.eventStatus),
                      padding: "6px 12px",
                      borderRadius: 999,
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    {formatTokenLabel(selectedEvent.eventStatus)}
                  </span>
                  <span
                    style={{
                      padding: "6px 12px",
                      borderRadius: 999,
                      fontSize: 13,
                      fontWeight: 700,
                      background: claimedByMe ? "#dbeafe" : "#f1f5f9",
                      color: claimedByMe ? "#1d4ed8" : "#334155",
                    }}
                  >
                    {queueOwnerLabel(selectedEvent)}
                  </span>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 12,
                }}
              >
                <div style={{ padding: 12, borderRadius: 12, background: "#f8fafc" }}>
                  <div style={{ color: "#64748b", fontSize: 12 }}>External ID</div>
                  <div style={{ marginTop: 4, fontWeight: 700 }}>
                    {selectedEvent.externalId || selectedEvent.transactionId || "-"}
                  </div>
                </div>
                <div style={{ padding: 12, borderRadius: 12, background: "#f8fafc" }}>
                  <div style={{ color: "#64748b", fontSize: 12 }}>Account Number</div>
                  <div style={{ marginTop: 4, fontWeight: 700 }}>
                    {selectedEvent.accountNumber || "-"}
                  </div>
                </div>
                <div style={{ padding: 12, borderRadius: 12, background: "#f8fafc" }}>
                  <div style={{ color: "#64748b", fontSize: 12 }}>Phone</div>
                  <div style={{ marginTop: 4, fontWeight: 700 }}>
                    {selectedEvent.phoneNumber || "-"}
                  </div>
                </div>
                <div style={{ padding: 12, borderRadius: 12, background: "#f8fafc" }}>
                  <div style={{ color: "#64748b", fontSize: 12 }}>Amount</div>
                  <div style={{ marginTop: 4, fontWeight: 700 }}>
                    {selectedEvent.amount != null ? `KES ${selectedEvent.amount}` : "-"}
                  </div>
                </div>
              </div>

              {selectedEvent.processingError ? (
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: 12,
                    background: "#fff7ed",
                    color: "#9a3412",
                    border: "1px solid #fed7aa",
                  }}
                >
                  {selectedEvent.processingError}
                </div>
              ) : null}

              {blockedByAnotherOperator ? (
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: 12,
                    background: "#eff6ff",
                    color: "#1d4ed8",
                    border: "1px solid #bfdbfe",
                  }}
                >
                  This orphan is currently claimed by {queueOwnerLabel(selectedEvent)}. Claim ownership will need to be released before you can adopt, retry, or resolve it.
                </div>
              ) : null}

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={handleClaim}
                  disabled={busyAction !== "" || claimedByMe || blockedByAnotherOperator}
                  style={{
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    borderRadius: 12,
                    padding: "10px 14px",
                    cursor:
                      !busyAction && !claimedByMe && !blockedByAnotherOperator
                        ? "pointer"
                        : "not-allowed",
                    fontWeight: 700,
                  }}
                >
                  {busyAction === "claim" ? "Claiming..." : "Claim Queue Ownership"}
                </button>
                <button
                  type="button"
                  onClick={handleRelease}
                  disabled={busyAction !== "" || !claimedByMe}
                  style={{
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    borderRadius: 12,
                    padding: "10px 14px",
                    cursor: !busyAction && claimedByMe ? "pointer" : "not-allowed",
                    fontWeight: 700,
                  }}
                >
                  {busyAction === "release" ? "Releasing..." : "Release Claim"}
                </button>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <label style={{ fontWeight: 700 }}>Target Tenant</label>
                <input
                  value={tenantQuery}
                  onChange={(e) => setTenantQuery(e.target.value)}
                  placeholder="Search by tenant name or subdomain"
                  style={{
                    padding: 11,
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                  }}
                />
                {tenantLoading ? (
                  <div style={{ color: "#64748b", fontSize: 14 }}>
                    Searching tenants...
                  </div>
                ) : null}
                {tenantResults.length ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    {tenantResults.map((tenant) => (
                      <button
                        key={tenant._id}
                        type="button"
                        onClick={() => {
                          setSelectedTenant(tenant);
                          setTenantQuery(tenant.name || tenant.subdomain || "");
                        }}
                        style={{
                          textAlign: "left",
                          padding: 12,
                          borderRadius: 12,
                          border:
                            selectedTenant?._id === tenant._id
                              ? "1px solid #2563eb"
                              : "1px solid #e2e8f0",
                          background:
                            selectedTenant?._id === tenant._id ? "#eff6ff" : "#fff",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>{tenant.name}</div>
                        <div style={{ color: "#64748b", marginTop: 4, fontSize: 13 }}>
                          {tenant.subdomain || "No subdomain"}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}

                {selectedTenant ? (
                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: 12,
                      background: "#eff6ff",
                      color: "#1d4ed8",
                      fontWeight: 700,
                    }}
                  >
                    Selected tenant: {selectedTenant.name}
                  </div>
                ) : null}
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <label style={{ fontWeight: 700 }}>Operator Note</label>
                <textarea
                  value={actionNote}
                  onChange={(e) => setActionNote(e.target.value)}
                  placeholder="Optional context for the audit trail"
                  rows={3}
                  style={{
                    padding: 12,
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                    resize: "vertical",
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={handleAdopt}
                  disabled={!selectedTenant?._id || busyAction !== "" || blockedByAnotherOperator}
                  style={{
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    borderRadius: 12,
                    padding: "10px 14px",
                    cursor:
                      selectedTenant?._id && !busyAction && !blockedByAnotherOperator
                        ? "pointer"
                        : "not-allowed",
                    fontWeight: 700,
                  }}
                >
                  {busyAction === "adopt" ? "Adopting..." : "Adopt To Tenant"}
                </button>
                <button
                  type="button"
                  onClick={handleRetry}
                  disabled={!selectedTenant?._id || busyAction !== "" || blockedByAnotherOperator}
                  style={{
                    border: "none",
                    background: "#0f172a",
                    color: "#fff",
                    borderRadius: 12,
                    padding: "10px 14px",
                    cursor:
                      selectedTenant?._id && !busyAction && !blockedByAnotherOperator
                        ? "pointer"
                        : "not-allowed",
                    fontWeight: 700,
                  }}
                >
                  {busyAction === "retry" ? "Retrying..." : "Adopt And Retry"}
                </button>
              </div>

              {resolutionType ? (
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ fontWeight: 800 }}>
                    Manual Resolution Target
                    <span style={{ color: "#64748b", fontWeight: 500 }}>
                      {" "}
                      · {resolutionType === "payment" ? "payment record" : "customer record"}
                    </span>
                  </div>
                  <input
                    value={resolutionQuery}
                    onChange={(e) => setResolutionQuery(e.target.value)}
                    placeholder={
                      resolutionType === "payment"
                        ? "Search by account, transaction, phone, or customer"
                        : "Search by account, name, phone, or email"
                    }
                    disabled={!selectedTenant?._id || blockedByAnotherOperator}
                    style={{
                      padding: 11,
                      borderRadius: 10,
                      border: "1px solid #cbd5e1",
                    }}
                  />

                  {resolutionLoading ? (
                    <div style={{ color: "#64748b", fontSize: 14 }}>
                      Searching resolution candidates...
                    </div>
                  ) : null}

                  {resolutionResults.length ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      {resolutionResults.map((item) => (
                        <button
                          key={item._id}
                          type="button"
                          onClick={() => setSelectedResolution(item)}
                          style={{
                            textAlign: "left",
                            padding: 12,
                            borderRadius: 12,
                            border:
                              selectedResolution?._id === item._id
                                ? "1px solid #2563eb"
                                : "1px solid #e2e8f0",
                            background:
                              selectedResolution?._id === item._id ? "#eff6ff" : "#fff",
                            cursor: "pointer",
                          }}
                        >
                          <div style={{ fontWeight: 700 }}>
                            {resolutionType === "payment"
                              ? item.accountNumber || item.transactionId || item._id
                              : item.name || item.accountNumber || item._id}
                          </div>
                          <div style={{ marginTop: 4, color: "#64748b", fontSize: 13 }}>
                            {resolutionType === "payment"
                              ? [
                                  item.customerName,
                                  item.planName,
                                  item.status,
                                  item.transactionId,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")
                              : [item.accountNumber, item.phone, item.email]
                                  .filter(Boolean)
                                  .join(" · ")}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : selectedTenant?._id && resolutionQuery.trim() ? (
                    <div style={{ color: "#64748b", fontSize: 14 }}>
                      No matching{" "}
                      {resolutionType === "payment" ? "payments" : "customers"} found
                      in the selected tenant.
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={handleResolve}
                    disabled={
                      !selectedTenant?._id ||
                      !selectedResolution?._id ||
                      busyAction !== "" ||
                      blockedByAnotherOperator
                    }
                    style={{
                      border: "none",
                      background: "#2563eb",
                      color: "#fff",
                      borderRadius: 12,
                      padding: "11px 14px",
                      cursor:
                        selectedTenant?._id &&
                        selectedResolution?._id &&
                        !busyAction &&
                        !blockedByAnotherOperator
                          ? "pointer"
                          : "not-allowed",
                      fontWeight: 700,
                    }}
                  >
                    {busyAction === "resolve"
                      ? "Resolving..."
                      : `Resolve To ${resolutionType === "payment" ? "Payment" : "Customer"}`}
                  </button>
                </div>
              ) : null}

              <div style={{ display: "grid", gap: 14 }}>
                <div>
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>
                    Queue Action History
                  </div>
                  {historyLoading ? (
                    <div style={{ color: "#64748b", fontSize: 14 }}>
                      Loading action history...
                    </div>
                  ) : actionHistory.length ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      {actionHistory.map((entry) => (
                        <div
                          key={entry._id}
                          style={{
                            padding: 12,
                            borderRadius: 12,
                            background: "#f8fafc",
                            border: "1px solid #e2e8f0",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 12,
                              flexWrap: "wrap",
                            }}
                          >
                            <div style={{ fontWeight: 700 }}>
                              {formatTokenLabel(entry.action)}
                            </div>
                            <div style={{ color: "#64748b", fontSize: 13 }}>
                              {formatDateTime(entry.createdAt)}
                            </div>
                          </div>
                          <div style={{ marginTop: 6, color: "#475569", fontSize: 13 }}>
                            {entry.actorDisplay || entry.actor || "Unknown operator"}
                          </div>
                          {entry.note ? (
                            <div style={{ marginTop: 6, color: "#334155", fontSize: 13 }}>
                              {entry.note}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ color: "#64748b", fontSize: 14 }}>
                      No queue actions recorded yet.
                    </div>
                  )}
                </div>

                <div>
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>Payload</div>
                  <pre
                    style={{
                      margin: 0,
                      padding: 14,
                      borderRadius: 12,
                      background: "#0f172a",
                      color: "#e2e8f0",
                      overflowX: "auto",
                      fontSize: 12,
                      lineHeight: 1.5,
                    }}
                  >
                    {formatJsonBlock(selectedEvent.payload)}
                  </pre>
                </div>
                <div>
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>Headers</div>
                  <pre
                    style={{
                      margin: 0,
                      padding: 14,
                      borderRadius: 12,
                      background: "#f8fafc",
                      color: "#0f172a",
                      overflowX: "auto",
                      fontSize: 12,
                      lineHeight: 1.5,
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    {formatJsonBlock(selectedEvent.headers)}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
