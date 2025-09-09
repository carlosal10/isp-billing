// src/components/CustomerDetailsPanel.jsx
import React, { useEffect, useState } from "react";
import { api } from "../lib/apiClient";

export default function CustomerDetailsPanel({ customer, onClose }) {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!customer?.accountNumber) return;
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
    return () => (cancelled = true);
  }, [customer?.accountNumber]);

  if (!customer) return null;

  const plan = customer.plan;
  const canToggle = customer.connectionType === "pppoe" && health && typeof health.disabled === "boolean";

  const doEnable = async () => {
    if (!customer?.accountNumber) return;
    setSaving(true);
    try {
      await api.post(`/pppoe/${encodeURIComponent(customer.accountNumber)}/enable`);
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
    <div style={{ border: '1px solid #e6eaf2', borderRadius: 12, padding: 16, background: '#fff', boxShadow: '0 2px 5px rgba(10,31,68,.08)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 20, color: '#0f172a' }}>{customer.name || '-'}</div>
          <div style={{ color: '#334155', marginTop: 2 }}>Account #{customer.accountNumber || '-'}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!!health && (
            <span
              title={health.disabled ? 'Disabled on router' : 'Active on router'}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999, padding: '6px 12px', background: health.disabled ? '#fee2e2' : '#eafaf1', color: health.disabled ? '#991b1b' : '#166534', fontWeight: 800, border: `1px solid ${health.disabled ? '#fecaca' : '#bbf7d0'}` }}
            >
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: health.disabled ? '#ef4444' : '#16a34a' }} />
              {health.disabled ? 'Inactive' : 'Active'}
            </span>
          )}
          <button className="btn" style={{ background: '#94a3b8' }} onClick={onClose}>Close</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10, background: '#f8fafc', border: '1px solid #e6eaf2', borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <div><div style={{ color: '#64748b', fontSize: 12 }}>Phone</div><div style={{ fontWeight: 700 }}>{customer.phone || '-'}</div></div>
        <div><div style={{ color: '#64748b', fontSize: 12 }}>Email</div><div style={{ fontWeight: 700 }}>{customer.email || '-'}</div></div>
        <div style={{ gridColumn: '1 / -1' }}><div style={{ color: '#64748b', fontSize: 12 }}>Address</div><div style={{ fontWeight: 700 }}>{customer.address || '-'}</div></div>
        <div><div style={{ color: '#64748b', fontSize: 12 }}>Plan</div><div style={{ fontWeight: 700 }}>{plan?.name || '-'}{plan?.speed ? ` • ${plan.speed}Mbps` : ''}</div></div>
        <div><div style={{ color: '#64748b', fontSize: 12 }}>Connection</div><div style={{ fontWeight: 700 }}>
          {customer.connectionType || '-'}
          {customer.connectionType === 'pppoe' && customer.pppoeConfig?.profile ? ` • ${customer.pppoeConfig.profile}` : ''}
          {customer.connectionType === 'static' && customer.staticConfig?.ip ? ` • ${customer.staticConfig.ip}` : ''}
        </div></div>
      </div>

      <div style={{ border: '1px solid #e6eaf2', borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>Router Health</div>
        {loading && <div>Loading health…</div>}
        {error && <div style={{ color: '#b91c1c' }}>{error}</div>}
        {!!health && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
            <div><div style={{ color: '#64748b', fontSize: 12 }}>Status</div><div style={{ fontWeight: 700 }}>{health.status || (health.disabled ? 'inactive' : 'active')}</div></div>
            {health.online !== null && (
              <div><div style={{ color: '#64748b', fontSize: 12 }}>Online</div><div style={{ fontWeight: 700 }}>{health.online ? 'Yes' : 'No'}</div></div>
            )}
            {health.uptime && (
              <div><div style={{ color: '#64748b', fontSize: 12 }}>Uptime</div><div style={{ fontWeight: 700 }}>{health.uptime}</div></div>
            )}
            {health.addressIp && (
              <div><div style={{ color: '#64748b', fontSize: 12 }}>IP</div><div style={{ fontWeight: 700 }}>{health.addressIp}</div></div>
            )}
            {(health.bytesIn || health.bytesOut) && (
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ color: '#64748b', fontSize: 12 }}>Usage</div>
                <div style={{ fontWeight: 700 }}>In {Number(health.bytesIn || 0).toLocaleString()} • Out {Number(health.bytesOut || 0).toLocaleString()}</div>
              </div>
            )}
            {typeof health.deviceCount === 'number' && (
              <div><div style={{ color: '#64748b', fontSize: 12 }}>Devices</div><div style={{ fontWeight: 700 }}>{health.deviceCount}</div></div>
            )}
          </div>
        )}

        {canToggle && (
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {health?.disabled ? (
              <button disabled={saving} onClick={doEnable} className="btn">Enable Account</button>
            ) : (
              <button disabled={saving} onClick={doDisable} className="btn">Disable Account</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

