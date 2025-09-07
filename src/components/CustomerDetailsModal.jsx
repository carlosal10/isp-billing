// src/components/CustomerDetailsModal.jsx
import React, { useEffect, useState } from "react";
import { Modal } from "./ui/Modal";
import { api } from "../lib/apiClient";

export default function CustomerDetailsModal({ open, onClose, customer }) {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !customer?.accountNumber) {
      setHealth(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get(`/customers/health/${encodeURIComponent(customer.accountNumber)}`)
      .then(({ data }) => {
        if (!cancelled) setHealth(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || "Failed to load health");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, customer?.accountNumber]);

  if (!open || !customer) return null;

  const plan = customer.plan;

  const canToggle = customer.connectionType === "pppoe" && health && typeof health.disabled === "boolean";

  const doEnable = async () => {
    if (!customer?.accountNumber) return;
    setSaving(true);
    try {
      await api.post(`/pppoe/${encodeURIComponent(customer.accountNumber)}/enable`);
      // refresh health
      const { data } = await api.get(`/customers/health/${encodeURIComponent(customer.accountNumber)}`);
      setHealth(data);
    } catch (e) {
      setError(e.message || "Enable failed");
    } finally {
      setSaving(false);
    }
  };

  const doDisable = async () => {
    if (!customer?.accountNumber) return;
    setSaving(true);
    try {
      await api.post(`/pppoe/${encodeURIComponent(customer.accountNumber)}/disable`, null, { params: { disconnect: true } });
      const { data } = await api.get(`/customers/health/${encodeURIComponent(customer.accountNumber)}`);
      setHealth(data);
    } catch (e) {
      setError(e.message || "Disable failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Customer Details">
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{customer.name || "-"}</div>
          {!!health && (
            <span
              title={health.disabled ? 'Disabled on router' : 'Active on router'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                borderRadius: 999, padding: '4px 10px',
                background: health.disabled ? '#fee2e2' : '#eafaf1',
                color: health.disabled ? '#991b1b' : '#166534', fontWeight: 700,
                border: `1px solid ${health.disabled ? '#fecaca' : '#bbf7d0'}`,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: health.disabled ? '#ef4444' : '#16a34a' }} />
              {health.disabled ? 'Inactive' : 'Active'}
            </span>
          )}
        </div>
        <div style={{ color: "#111" }}>
          <strong>Account:</strong> {customer.accountNumber || "-"}
        </div>
        <div style={{ color: "#111" }}>
          <strong>Phone:</strong> {customer.phone || "-"}
        </div>
        <div style={{ color: "#111" }}>
          <strong>Email:</strong> {customer.email || "-"}
        </div>
        <div style={{ color: "#111" }}>
          <strong>Address:</strong> {customer.address || "-"}
        </div>
        <div style={{ color: "#111" }}>
          <strong>Plan:</strong> {plan?.name || "-"} {plan?.speed ? `• ${plan.speed}Mbps` : ""}
        </div>
        <div style={{ color: "#111" }}>
          <strong>Connection:</strong> {customer.connectionType || "-"}
          {customer.connectionType === "pppoe" && customer.pppoeConfig?.profile
            ? ` • PPPoE Profile: ${customer.pppoeConfig.profile}`
            : ""}
          {customer.connectionType === "static" && customer.staticConfig?.ip
            ? ` • IP: ${customer.staticConfig.ip}`
            : ""}
        </div>

        <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #e6eaf2" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Router Health</div>
          {loading && <div>Loading health…</div>}
          {error && <div style={{ color: "#b91c1c" }}>{error}</div>}
          {!!health && (
            <div style={{ display: "grid", gap: 6 }}>
              <div>
                <strong>Status:</strong> {health.status || (health.disabled ? "inactive" : "active")}
              </div>
              {health.online !== null && (
                <div>
                  <strong>Online:</strong> {health.online ? "Yes" : "No"}
                </div>
              )}
              {health.uptime && (
                <div>
                  <strong>Uptime:</strong> {health.uptime}
                </div>
              )}
              {(health.bytesIn || health.bytesOut) && (
                <div>
                  <strong>Usage:</strong> In {Number(health.bytesIn || 0).toLocaleString()} • Out {Number(health.bytesOut || 0).toLocaleString()}
                </div>
              )}
              {health.addressIp && (
                <div>
                  <strong>IP:</strong> {health.addressIp}
                </div>
              )}
              {typeof health.deviceCount === "number" && (
                <div>
                  <strong>Devices:</strong> {health.deviceCount}
                </div>
              )}
              {canToggle && (
                <div style={{ marginTop: 8 }}>
                  {health.disabled ? (
                    <button disabled={saving} onClick={doEnable} className="btn">Enable Account</button>
                  ) : (
                    <button disabled={saving} onClick={doDisable} className="btn">Disable Account</button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
