import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/apiClient";
import { useAuth } from "../context/AuthContext";

const EMPTY_INCIDENT_FORM = {
  title: "",
  summary: "",
  kind: "outage",
  severity: "medium",
  status: "open",
  site: "",
  routerName: "",
  detectedAt: "",
  startedAt: "",
  plannedStart: "",
  plannedEnd: "",
  customerQuery: "",
  affectedCustomers: [],
  affectedAssetIds: [],
  assetIdToAdd: "",
  update: "",
  tags: "",
  notificationState: "not_started",
};

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "-";
}

function toDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60 * 1000).toISOString().slice(0, 16);
}

function formatToken(value) {
  return String(value || "")
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function statusBadge(value) {
  const status = String(value || "").toLowerCase();
  if (["critical"].includes(status)) return { background: "#fee2e2", color: "#991b1b" };
  if (["resolved", "closed"].includes(status)) return { background: "#dcfce7", color: "#166534" };
  if (["scheduled", "maintenance"].includes(status)) return { background: "#fef3c7", color: "#92400e" };
  if (["monitoring", "investigating", "open", "high"].includes(status)) return { background: "#dbeafe", color: "#1d4ed8" };
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

function SummaryCard({ title, value, accent, hint }) {
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
      <div style={{ color: "#64748b", fontSize: 13, fontWeight: 700 }}>{title}</div>
      <div style={{ marginTop: 8, fontSize: 30, fontWeight: 800, color: accent || "#0f172a" }}>{value}</div>
      {hint ? <div style={{ marginTop: 8, color: "#475569", fontSize: 13 }}>{hint}</div> : null}
    </div>
  );
}

function CustomerSearchResults({ results, onSelect }) {
  if (!results.length) return null;
  return (
    <div
      style={{
        marginTop: 8,
        border: "1px solid #e2e8f0",
        borderRadius: 14,
        overflow: "hidden",
        background: "#fff",
        boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
      }}
    >
      {results.map((customer) => (
        <button
          key={customer._id}
          type="button"
          onClick={() => onSelect(customer)}
          style={{
            width: "100%",
            textAlign: "left",
            border: "none",
            borderBottom: "1px solid #f1f5f9",
            background: "#fff",
            padding: "12px 14px",
            cursor: "pointer",
          }}
        >
          <strong>{customer.name || "Unnamed customer"}</strong>
          <div style={{ marginTop: 4, color: "#64748b", fontSize: 13 }}>
            {customer.accountNumber || "No account"} | {customer.phone || customer.email || "No contact"}
          </div>
        </button>
      ))}
    </div>
  );
}

function SelectionChips({ items, onRemove, renderLabel }) {
  if (!items.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
      {items.map((item) => (
        <button
          key={item._id}
          type="button"
          onClick={() => onRemove(item._id)}
          style={{
            border: "1px solid #cbd5e1",
            borderRadius: 999,
            background: "#f8fafc",
            padding: "6px 10px",
            cursor: "pointer",
            color: "#0f172a",
            fontSize: 13,
          }}
        >
          {renderLabel(item)} x
        </button>
      ))}
    </div>
  );
}

async function fetchNocSnapshot() {
  const [summaryRes, incidentsRes, assetsRes] = await Promise.all([
    api.get("/noc/summary"),
    api.get("/noc/incidents", { params: { limit: 200 } }),
    api.get("/service-ops/assets"),
  ]);

  return {
    summary: summaryRes.data || {},
    incidents: Array.isArray(incidentsRes.data) ? incidentsRes.data : [],
    assets: Array.isArray(assetsRes.data) ? assetsRes.data : [],
  };
}

export default function NocOperations() {
  const { role, status } = useAuth();
  const canManage = role === "owner" || role === "admin";

  const [summary, setSummary] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [editingIncidentId, setEditingIncidentId] = useState("");
  const [incidentForm, setIncidentForm] = useState(EMPTY_INCIDENT_FORM);
  const [customerResults, setCustomerResults] = useState([]);
  const [customerLoading, setCustomerLoading] = useState(false);

  const activeAssets = useMemo(
    () => assets.filter((asset) => asset.status !== "retired"),
    [assets]
  );

  const loadSnapshot = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const snapshot = await fetchNocSnapshot();
      setSummary(snapshot.summary);
      setIncidents(snapshot.incidents);
      setAssets(snapshot.assets);
      setError("");
    } catch (err) {
      console.error("Failed to load NOC snapshot:", err);
      setError(err?.message || "Failed to load NOC data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (status !== "auth" || !canManage) return;
    loadSnapshot(true);
  }, [status, canManage]);

  useEffect(() => {
    if (!incidentForm.customerQuery.trim()) {
      setCustomerResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setCustomerLoading(true);
      try {
        const { data } = await api.get("/customers/search", {
          params: { query: incidentForm.customerQuery.trim() },
        });
        setCustomerResults(
          (Array.isArray(data) ? data : []).filter(
            (customer) => !incidentForm.affectedCustomers.some((item) => item._id === customer._id)
          )
        );
      } catch (err) {
        console.error("Incident customer search failed:", err);
      } finally {
        setCustomerLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [incidentForm.affectedCustomers, incidentForm.customerQuery]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setIncidentForm((current) => ({
      ...current,
      [name]: value,
      ...(name === "kind" && !editingIncidentId
        ? { status: value === "maintenance" ? "scheduled" : "open" }
        : {}),
    }));
  };

  const resetForm = () => {
    setEditingIncidentId("");
    setIncidentForm(EMPTY_INCIDENT_FORM);
    setCustomerResults([]);
  };

  const addCustomer = (customer) => {
    setIncidentForm((current) => ({
      ...current,
      customerQuery: "",
      affectedCustomers: current.affectedCustomers.some((item) => item._id === customer._id)
        ? current.affectedCustomers
        : [
            ...current.affectedCustomers,
            {
              _id: customer._id,
              name: customer.name || "Customer",
              accountNumber: customer.accountNumber || "",
            },
          ],
    }));
    setCustomerResults([]);
  };

  const removeCustomer = (customerId) => {
    setIncidentForm((current) => ({
      ...current,
      affectedCustomers: current.affectedCustomers.filter((item) => item._id !== customerId),
    }));
  };

  const addAsset = () => {
    if (!incidentForm.assetIdToAdd) return;
    setIncidentForm((current) => ({
      ...current,
      assetIdToAdd: "",
      affectedAssetIds: current.affectedAssetIds.includes(current.assetIdToAdd)
        ? current.affectedAssetIds
        : [...current.affectedAssetIds, current.assetIdToAdd],
    }));
  };

  const removeAsset = (assetId) => {
    setIncidentForm((current) => ({
      ...current,
      affectedAssetIds: current.affectedAssetIds.filter((id) => id !== assetId),
    }));
  };

  const startEdit = (incident) => {
    setEditingIncidentId(incident._id);
    setIncidentForm({
      title: incident.title || "",
      summary: incident.summary || "",
      kind: incident.kind || "outage",
      severity: incident.severity || "medium",
      status: incident.status || "open",
      site: incident.site || "",
      routerName: incident.routerName || "",
      detectedAt: toDateTimeLocal(incident.detectedAt),
      startedAt: toDateTimeLocal(incident.startedAt),
      plannedStart: toDateTimeLocal(incident.plannedStart),
      plannedEnd: toDateTimeLocal(incident.plannedEnd),
      customerQuery: "",
      affectedCustomers: Array.isArray(incident.affectedCustomers) ? incident.affectedCustomers : [],
      affectedAssetIds: Array.isArray(incident.affectedAssets)
        ? incident.affectedAssets.map((asset) => asset._id)
        : [],
      assetIdToAdd: "",
      update: "",
      tags: Array.isArray(incident.tags) ? incident.tags.join(", ") : "",
      notificationState: incident.notificationState || "not_started",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submitIncident = async (event) => {
    event.preventDefault();
    setBusyAction("incident:save");
    setMessage("");
    setError("");
    try {
      const payload = {
        title: incidentForm.title,
        summary: incidentForm.summary || undefined,
        kind: incidentForm.kind,
        severity: incidentForm.severity,
        status: incidentForm.status,
        site: incidentForm.site || undefined,
        routerName: incidentForm.routerName || undefined,
        detectedAt: incidentForm.detectedAt || undefined,
        startedAt: incidentForm.startedAt || undefined,
        plannedStart: incidentForm.plannedStart || undefined,
        plannedEnd: incidentForm.plannedEnd || undefined,
        affectedCustomerIds: incidentForm.affectedCustomers.map((customer) => customer._id),
        affectedAssetIds: incidentForm.affectedAssetIds,
        update: incidentForm.update || undefined,
        tags: incidentForm.tags
          ? incidentForm.tags.split(",").map((item) => item.trim()).filter(Boolean)
          : [],
        notificationState: incidentForm.notificationState,
      };

      if (editingIncidentId) {
        await api.put(`/noc/incidents/${editingIncidentId}`, payload);
        setMessage("Incident updated.");
      } else {
        await api.post("/noc/incidents", payload);
        setMessage("Incident created.");
      }

      resetForm();
      await loadSnapshot(false);
    } catch (err) {
      setError(err?.message || "Failed to save incident");
    } finally {
      setBusyAction("");
    }
  };

  if (status === "unknown") {
    return <div style={{ padding: 20 }}>Checking session...</div>;
  }
  if (status !== "auth") {
    return <div style={{ padding: 20 }}>Please log in to manage NOC operations.</div>;
  }
  if (!canManage) {
    return <div style={{ padding: 20 }}>NOC operations are limited to tenant owners and admins.</div>;
  }

  const selectedAssets = incidentForm.affectedAssetIds
    .map((assetId) => activeAssets.find((asset) => asset._id === assetId))
    .filter(Boolean);

  return (
    <div
      style={{
        padding: 20,
        display: "grid",
        gap: 20,
        background: "linear-gradient(180deg, #f8fafc 0%, #fff7ed 100%)",
        minHeight: "100%",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <SummaryCard title="Active Incidents" value={summary?.activeIncidents ?? "-"} accent="#0f172a" hint={`${summary?.investigatingIncidents ?? 0} investigating`} />
        <SummaryCard title="Critical Incidents" value={summary?.criticalIncidents ?? "-"} accent="#b91c1c" hint={`${summary?.monitoringIncidents ?? 0} monitoring`} />
        <SummaryCard title="Scheduled Maintenance" value={summary?.scheduledMaintenance ?? "-"} accent="#92400e" hint="Planned network work" />
        <SummaryCard title="Resolved This Week" value={summary?.resolvedThisWeek ?? "-"} accent="#166534" hint="Recently closed issues" />
      </div>

      {error ? (
        <div className="msg-err" role="alert">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="msg-ok" role="status">
          {message}
        </div>
      ) : null}

      <SectionCard
        title={editingIncidentId ? "Edit Incident" : "Declare Incident"}
        subtitle="Track outages, degradations, and maintenance windows with customer and asset impact attached."
        actions={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {editingIncidentId ? (
              <button type="button" className="secondary" onClick={resetForm}>
                Cancel Edit
              </button>
            ) : null}
            <button type="button" className="secondary" onClick={() => loadSnapshot(false)} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        }
      >
        <form onSubmit={submitIncident} className="stacked-form" style={{ padding: 0 }}>
          <div className="field">
            <input name="title" value={incidentForm.title} onChange={handleChange} placeholder="Incident title" required />
          </div>
          <div className="field">
            <select name="kind" value={incidentForm.kind} onChange={handleChange}>
              <option value="outage">Outage</option>
              <option value="degradation">Degradation</option>
              <option value="maintenance">Maintenance</option>
              <option value="security">Security</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="field">
            <select name="severity" value={incidentForm.severity} onChange={handleChange}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div className="field">
            <select name="status" value={incidentForm.status} onChange={handleChange}>
              <option value="scheduled">Scheduled</option>
              <option value="open">Open</option>
              <option value="investigating">Investigating</option>
              <option value="monitoring">Monitoring</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div className="field">
            <input name="site" value={incidentForm.site} onChange={handleChange} placeholder="Site / tower / POP" />
          </div>
          <div className="field">
            <input name="routerName" value={incidentForm.routerName} onChange={handleChange} placeholder="Router / node name" />
          </div>
          <div className="field">
            <input type="datetime-local" name="detectedAt" value={incidentForm.detectedAt} onChange={handleChange} />
            <p className="help-text">Detection time.</p>
          </div>
          <div className="field">
            <input type="datetime-local" name="startedAt" value={incidentForm.startedAt} onChange={handleChange} />
            <p className="help-text">Service impact start.</p>
          </div>
          <div className="field">
            <input type="datetime-local" name="plannedStart" value={incidentForm.plannedStart} onChange={handleChange} />
            <p className="help-text">Planned start for maintenance.</p>
          </div>
          <div className="field">
            <input type="datetime-local" name="plannedEnd" value={incidentForm.plannedEnd} onChange={handleChange} />
            <p className="help-text">Planned end for maintenance.</p>
          </div>
          <div className="field">
            <select name="notificationState" value={incidentForm.notificationState} onChange={handleChange}>
              <option value="not_started">Notification Not Started</option>
              <option value="drafted">Notification Drafted</option>
              <option value="sent">Notification Sent</option>
            </select>
          </div>
          <div className="field" style={{ gridColumn: "span 3" }}>
            <textarea
              name="summary"
              value={incidentForm.summary}
              onChange={handleChange}
              rows={3}
              placeholder="What is happening, which sites are affected, and what operators should know"
            />
          </div>
          <div className="field" style={{ position: "relative", gridColumn: "span 2" }}>
            <input
              name="customerQuery"
              value={incidentForm.customerQuery}
              onChange={handleChange}
              placeholder="Search affected customers by name or account number"
            />
            {customerLoading ? <div className="help-text">Searching...</div> : null}
            <CustomerSearchResults results={customerResults} onSelect={addCustomer} />
            <SelectionChips
              items={incidentForm.affectedCustomers}
              onRemove={removeCustomer}
              renderLabel={(customer) => `${customer.name} (${customer.accountNumber || "N/A"})`}
            />
          </div>
          <div className="field">
            <select name="assetIdToAdd" value={incidentForm.assetIdToAdd} onChange={handleChange}>
              <option value="">Add affected asset</option>
              {activeAssets
                .filter((asset) => !incidentForm.affectedAssetIds.includes(asset._id))
                .map((asset) => (
                  <option key={asset._id} value={asset._id}>
                    {asset.assetTag} | {asset.name}
                  </option>
                ))}
            </select>
            <div style={{ marginTop: 8 }}>
              <button type="button" className="secondary" onClick={addAsset}>
                Add Asset
              </button>
            </div>
            <SelectionChips
              items={selectedAssets}
              onRemove={removeAsset}
              renderLabel={(asset) => `${asset.assetTag} (${asset.name || asset.kind || "Asset"})`}
            />
          </div>
          <div className="field">
            <input name="tags" value={incidentForm.tags} onChange={handleChange} placeholder="Tags (comma separated)" />
          </div>
          <div className="field" style={{ gridColumn: "span 2" }}>
            <textarea
              name="update"
              value={incidentForm.update}
              onChange={handleChange}
              rows={2}
              placeholder={editingIncidentId ? "Add an incident timeline update" : "Opening incident note"}
            />
          </div>
          <button type="submit" className="primary" disabled={busyAction === "incident:save"}>
            {busyAction === "incident:save"
              ? "Saving..."
              : editingIncidentId
                ? "Update Incident"
                : "Create Incident"}
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Incident Timeline" subtitle="Review outage response, maintenance schedules, and affected scope in one place.">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Incident</th>
                <th>Kind</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Site</th>
                <th>Impact</th>
                <th>Window</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {incidents.length ? (
                incidents.map((incident) => {
                  const severityBadge = statusBadge(incident.severity);
                  const statusPill = statusBadge(incident.status);
                  return (
                    <tr key={incident._id}>
                      <td>
                        <strong>{incident.incidentNumber}</strong>
                        <div style={{ marginTop: 4, color: "#0f172a", fontSize: 13 }}>{incident.title}</div>
                        <div style={{ marginTop: 4, color: "#64748b", fontSize: 12 }}>{incident.routerName || "No router named"}</div>
                      </td>
                      <td>{formatToken(incident.kind)}</td>
                      <td>
                        <span style={{ display: "inline-flex", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, ...severityBadge }}>
                          {formatToken(incident.severity)}
                        </span>
                      </td>
                      <td>
                        <span style={{ display: "inline-flex", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, ...statusPill }}>
                          {formatToken(incident.status)}
                        </span>
                      </td>
                      <td>{incident.site || "-"}</td>
                      <td>
                        {incident.affectedCustomerCount || 0} customers
                        <div style={{ marginTop: 4, color: "#64748b", fontSize: 13 }}>
                          {incident.affectedAssetCount || 0} assets
                        </div>
                      </td>
                      <td>
                        <div style={{ color: "#0f172a", fontSize: 13 }}>
                          Start: {formatDateTime(incident.startedAt)}
                        </div>
                        <div style={{ marginTop: 4, color: "#64748b", fontSize: 13 }}>
                          End: {formatDateTime(incident.plannedEnd || incident.resolvedAt)}
                        </div>
                      </td>
                      <td className="actions" style={{ textAlign: "right" }}>
                        <button type="button" className="secondary table-action" onClick={() => startEdit(incident)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center" }}>No incidents or maintenance windows yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
