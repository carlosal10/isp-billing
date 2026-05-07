import React, { useEffect, useState } from "react";
import { api } from "../lib/apiClient";

function formatDate(value) {
  if (!value) return "Never";
  const dt = new Date(value);
  if (!Number.isFinite(dt.getTime())) return "Never";
  return dt.toLocaleString();
}

function initialAccessFromCustomer(customer) {
  if (!customer?._id) return null;
  const profile = customer.portalProfile || {};
  return {
    customerId: customer._id,
    accountNumber: customer.accountNumber || null,
    name: customer.name || null,
    portalProfile: {
      isEnabled: profile.isEnabled !== false,
      hasPin: Boolean(profile.hasPin),
      lastLoginAt: profile.lastLoginAt || null,
      lastLoginMethod: profile.lastLoginMethod || null,
      lastSeenAt: profile.lastSeenAt || null,
    },
  };
}

export default function CustomerPortalAccessCard({ customer, onUpdated }) {
  const [access, setAccess] = useState(() => initialAccessFromCustomer(customer));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!customer?._id) {
      setAccess(null);
      setPin("");
      setReason("");
      return;
    }

    let cancelled = false;
    setAccess(initialAccessFromCustomer(customer));
    setLoading(true);
    setError(null);
    setMessage(null);

    api
      .get(`/customers/${customer._id}/portal-access`)
      .then(({ data }) => {
        if (!cancelled) setAccess(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || "Failed to load portal access");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [customer]);

  if (!customer?._id) return null;

  const profile = access?.portalProfile || {};
  const isEnabled = profile.isEnabled !== false;
  const hasPin = Boolean(profile.hasPin);

  const updateAccess = async (payload, successMessage) => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const body = {
        ...payload,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      };
      const { data } = await api.put(`/customers/${customer._id}/portal-access`, body);
      const nextAccess = data?.access || data;
      setAccess(nextAccess);
      setPin("");
      setMessage(successMessage || data?.message || "Portal access updated");
      await onUpdated?.(nextAccess);
    } catch (err) {
      setError(err?.message || "Failed to update portal access");
    } finally {
      setSaving(false);
    }
  };

  const statusBg = isEnabled ? "#eafaf1" : "#fee2e2";
  const statusColor = isEnabled ? "#166534" : "#991b1b";
  const statusBorder = isEnabled ? "#bbf7d0" : "#fecaca";

  return (
    <div style={{ border: "1px solid #e6eaf2", borderRadius: 12, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: 4 }}>Portal Access</div>
          <div style={{ color: "#64748b", fontSize: 13 }}>
            Customer self-service for invoices, payments, tickets, outages, and PIN security.
          </div>
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            borderRadius: 999,
            padding: "6px 12px",
            background: statusBg,
            color: statusColor,
            border: `1px solid ${statusBorder}`,
            fontWeight: 800,
            whiteSpace: "nowrap",
          }}
        >
          {isEnabled ? "Enabled" : "Disabled"}
        </span>
      </div>

      {loading && <div style={{ marginTop: 10 }}>Loading portal access...</div>}
      {error && <div style={{ color: "#b91c1c", marginTop: 10 }}>{error}</div>}
      {message && <div style={{ color: "#166534", marginTop: 10 }}>{message}</div>}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,minmax(0,1fr))",
          gap: 10,
          marginTop: 12,
          background: "#f8fafc",
          border: "1px solid #eef2f7",
          borderRadius: 10,
          padding: 10,
        }}
      >
        <div>
          <div style={{ color: "#64748b", fontSize: 12 }}>PIN</div>
          <div style={{ fontWeight: 700 }}>{hasPin ? "Configured" : "Not set"}</div>
        </div>
        <div>
          <div style={{ color: "#64748b", fontSize: 12 }}>Last Login</div>
          <div style={{ fontWeight: 700 }}>{formatDate(profile.lastLoginAt)}</div>
        </div>
        <div>
          <div style={{ color: "#64748b", fontSize: 12 }}>Last Seen</div>
          <div style={{ fontWeight: 700 }}>{formatDate(profile.lastSeenAt)}</div>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <div style={{ color: "#64748b", fontSize: 12 }}>Login Method</div>
          <div style={{ fontWeight: 700 }}>{profile.lastLoginMethod || "-"}</div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        <input
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
          placeholder="Set or reset customer PIN (4-8 digits)"
          inputMode="numeric"
          autoComplete="new-password"
          style={{ padding: "10px 12px", border: "1px solid #e6eaf2", borderRadius: 10 }}
        />
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Optional audit reason"
          style={{ padding: "10px 12px", border: "1px solid #e6eaf2", borderRadius: 10 }}
        />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button
          className="btn"
          disabled={saving || loading}
          style={{ background: isEnabled ? "#ef4444" : "#16a34a" }}
          onClick={() =>
            updateAccess(
              { isEnabled: !isEnabled },
              isEnabled ? "Customer portal access disabled" : "Customer portal access enabled"
            )
          }
        >
          {isEnabled ? "Disable Portal" : "Enable Portal"}
        </button>
        <button
          className="btn"
          disabled={saving || loading || pin.length < 4}
          onClick={() => updateAccess({ pin }, "Customer portal PIN updated")}
        >
          Set PIN
        </button>
        <button
          className="btn"
          disabled={saving || loading || !hasPin}
          style={{ background: "#64748b" }}
          onClick={() => updateAccess({ clearPin: true }, "Customer portal PIN cleared")}
        >
          Clear PIN
        </button>
      </div>
    </div>
  );
}
