// src/components/StatsCards.jsx
import useStats from "../hooks/useStats";
import "./StatsCards.css";

/**
 * Props:
 * - stats, loading: when provided, component is view-only (no fetch)
 * - autoFetch (default false): if true and no stats prop, it will fetch
 * - endpoint, intervalMs: customize fetching when autoFetch is used
 */
export default function StatsCards({
  stats,
  loading,
  autoFetch = false,
  endpoint,
  intervalMs = 60000,
}) {
  const usingProps = stats !== undefined;

  // Call the hook unconditionally; control behavior via `enabled`
  const { stats: fetched, loading: hookLoading, error } = useStats({
    endpoint,
    intervalMs,
    enabled: autoFetch && !usingProps,
  });

  const data = usingProps
    ? stats
    : fetched || { totalCustomers: 0, activePlans: 0, pendingInvoices: 0 };

  const busy = usingProps ? !!loading : !!hookLoading;

  const items = [
    { key: "activePlans", label: "Active Plans", value: data.activePlans ?? 0 },
    { key: "pendingInvoices", label: "Pending Invoices", value: data.pendingInvoices ?? 0 },
  ];

  return (
    <div className="stats-cards" role="list" aria-busy={busy}>
      {items.map((it) => (
        <div className="stat-card" role="listitem" key={it.key}>
          <div className="stat-label">{it.label}</div>
          <div className={`stat-value ${busy ? "is-loading" : ""}`}>
            {busy ? "..." : it.value}
          </div>
        </div>
      ))}

      {!usingProps && error && (
        <div className="stat-error" role="alert">
          Failed to load stats: {String(error.message || error)}
        </div>
      )}
    </div>
  );
}

