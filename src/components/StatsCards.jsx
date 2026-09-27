// src/components/StatsCards.jsx
import useStats from "../hooks/useStats";
import { MdGroups, MdPayments, MdSpeed } from "react-icons/md";
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
    {
      key: "totalCustomers",
      label: "Customers",
      value: data.totalCustomers ?? 0,
      detail: "Subscriber records",
      icon: MdGroups,
      tone: "blue",
    },
    {
      key: "activePlans",
      label: "Active plans",
      value: data.activePlans ?? 0,
      detail: "Commercial offers",
      icon: MdSpeed,
      tone: "green",
    },
    {
      key: "pendingInvoices",
      label: "Pending invoices",
      value: data.pendingInvoices ?? 0,
      detail: "Awaiting settlement",
      icon: MdPayments,
      tone: "amber",
    },
  ];

  return (
    <div className="stats-cards" role="list" aria-busy={busy}>
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <div className={`stat-card tone-${it.tone}`} role="listitem" key={it.key}>
            <div className="stat-card-topline">
              <div className="stat-label">{it.label}</div>
              <span className="stat-icon" aria-hidden="true"><Icon /></span>
            </div>
            <div className={`stat-value ${busy ? "is-loading" : ""}`}>
              {busy ? "..." : Number(it.value).toLocaleString()}
            </div>
            <div className="stat-detail">{it.detail}</div>
          </div>
        );
      })}

      {!usingProps && error && (
        <div className="stat-error" role="alert">
          Failed to load stats: {String(error.message || error)}
        </div>
      )}
    </div>
  );
}

