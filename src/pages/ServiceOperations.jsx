import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/apiClient";
import { useAuth } from "../context/AuthContext";

const EMPTY_ASSET_FORM = {
  assetTag: "",
  name: "",
  kind: "cpe",
  status: "in_stock",
  vendor: "",
  model: "",
  serialNumber: "",
  macAddress: "",
  site: "",
  location: "",
  notes: "",
};

const EMPTY_ASSIGNMENT_FORM = {
  assetId: "",
  customerQuery: "",
  customerId: "",
  customerLabel: "",
  installedAt: "",
  notes: "",
};

const EMPTY_POOL_FORM = {
  name: "",
  cidr: "",
  kind: "static",
  gateway: "",
  dnsServers: "",
  vlanId: "",
  site: "",
  status: "active",
  notes: "",
};

const EMPTY_IP_FORM = {
  poolId: "",
  purpose: "customer-wan",
  ipAddress: "",
  customerQuery: "",
  customerId: "",
  customerLabel: "",
  assetId: "",
  note: "",
};

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "-";
}

function formatToken(value) {
  return String(value || "")
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function poolDescriptor(pool) {
  if (!pool) return "-";
  if (pool.allocationStrategy === "list") {
    const count = Array.isArray(pool.addressList) ? pool.addressList.length : 0;
    return `${count} listed IP${count === 1 ? "" : "s"}`;
  }
  return pool.cidr || "-";
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

function statusBadge(value) {
  const status = String(value || "").toLowerCase();
  if (["active", "assigned", "allocated"].includes(status)) {
    return { background: "#dcfce7", color: "#166534" };
  }
  if (["reserved", "maintenance"].includes(status)) {
    return { background: "#fef3c7", color: "#92400e" };
  }
  if (["disabled", "faulty", "retired", "released"].includes(status)) {
    return { background: "#fee2e2", color: "#991b1b" };
  }
  return { background: "#e2e8f0", color: "#475569" };
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

async function fetchServiceOpsSnapshot() {
  const [summaryRes, assetsRes, poolsRes, assignmentsRes] = await Promise.all([
    api.get("/service-ops/summary"),
    api.get("/service-ops/assets"),
    api.get("/service-ops/ip-pools"),
    api.get("/service-ops/ip-assignments", { params: { limit: 200 } }),
  ]);

  return {
    summary: summaryRes.data || {},
    assets: Array.isArray(assetsRes.data) ? assetsRes.data : [],
    pools: Array.isArray(poolsRes.data) ? poolsRes.data : [],
    assignments: Array.isArray(assignmentsRes.data) ? assignmentsRes.data : [],
  };
}

export default function ServiceOperations() {
  const { status, role } = useAuth();
  const canManage = role === "owner" || role === "admin" || role === "platform-admin";

  const [summary, setSummary] = useState(null);
  const [assets, setAssets] = useState([]);
  const [pools, setPools] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");

  const [assetForm, setAssetForm] = useState(EMPTY_ASSET_FORM);
  const [assetAssignmentForm, setAssetAssignmentForm] = useState(EMPTY_ASSIGNMENT_FORM);
  const [poolForm, setPoolForm] = useState(EMPTY_POOL_FORM);
  const [ipForm, setIpForm] = useState(EMPTY_IP_FORM);

  const [assetCustomerResults, setAssetCustomerResults] = useState([]);
  const [assetCustomerLoading, setAssetCustomerLoading] = useState(false);
  const [ipCustomerResults, setIpCustomerResults] = useState([]);
  const [ipCustomerLoading, setIpCustomerLoading] = useState(false);

  const assetOptions = useMemo(
    () => assets.filter((asset) => asset.status !== "retired"),
    [assets]
  );
  const activePoolOptions = useMemo(
    () => pools.filter((pool) => pool.status === "active"),
    [pools]
  );
  const activeAssignments = useMemo(
    () => assignments.filter((assignment) => assignment.releasedAt == null),
    [assignments]
  );

  const loadSnapshot = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const snapshot = await fetchServiceOpsSnapshot();
      setSummary(snapshot.summary);
      setAssets(snapshot.assets);
      setPools(snapshot.pools);
      setAssignments(snapshot.assignments);
      setError("");
    } catch (err) {
      console.error("Failed to load service ops snapshot:", err);
      setError(err?.message || "Failed to load service operations data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (status !== "auth" || !canManage) return;
    loadSnapshot(true);
  }, [status, canManage]);

  useEffect(() => {
    if (!assetAssignmentForm.customerQuery.trim() || assetAssignmentForm.customerId) {
      setAssetCustomerResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setAssetCustomerLoading(true);
      try {
        const { data } = await api.get("/customers/search", {
          params: { query: assetAssignmentForm.customerQuery.trim() },
        });
        setAssetCustomerResults(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Asset customer search failed:", err);
      } finally {
        setAssetCustomerLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [assetAssignmentForm.customerQuery, assetAssignmentForm.customerId]);

  useEffect(() => {
    if (!ipForm.customerQuery.trim() || ipForm.customerId) {
      setIpCustomerResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setIpCustomerLoading(true);
      try {
        const { data } = await api.get("/customers/search", {
          params: { query: ipForm.customerQuery.trim() },
        });
        setIpCustomerResults(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("IP allocation customer search failed:", err);
      } finally {
        setIpCustomerLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [ipForm.customerQuery, ipForm.customerId]);

  const handleAssetChange = (event) => {
    const { name, value } = event.target;
    setAssetForm((current) => ({ ...current, [name]: value }));
  };

  const handlePoolChange = (event) => {
    const { name, value } = event.target;
    setPoolForm((current) => ({ ...current, [name]: value }));
  };

  const handleAssignmentChange = (event) => {
    const { name, value } = event.target;
    setAssetAssignmentForm((current) => ({
      ...current,
      [name]: value,
      ...(name === "customerQuery"
        ? { customerId: "", customerLabel: "" }
        : {}),
    }));
  };

  const handleIpFormChange = (event) => {
    const { name, value } = event.target;
    setIpForm((current) => ({
      ...current,
      [name]: value,
      ...(name === "customerQuery"
        ? { customerId: "", customerLabel: "" }
        : {}),
    }));
  };

  const submitAsset = async (event) => {
    event.preventDefault();
    setBusyAction("asset:create");
    setMessage("");
    try {
      await api.post("/service-ops/assets", assetForm);
      setAssetForm(EMPTY_ASSET_FORM);
      setMessage("Inventory asset created.");
      await loadSnapshot(false);
    } catch (err) {
      setError(err?.message || "Failed to create asset");
    } finally {
      setBusyAction("");
    }
  };

  const submitAssetAssignment = async (event) => {
    event.preventDefault();
    if (!assetAssignmentForm.assetId) {
      setError("Choose an asset before linking a customer.");
      return;
    }
    if (!assetAssignmentForm.customerId) {
      setError("Choose a customer before linking an asset.");
      return;
    }
    setBusyAction("asset:assign");
    setMessage("");
    try {
      await api.post(`/service-ops/assets/${assetAssignmentForm.assetId}/assign-customer`, {
        customerId: assetAssignmentForm.customerId,
        installedAt: assetAssignmentForm.installedAt || undefined,
        notes: assetAssignmentForm.notes || undefined,
      });
      setAssetAssignmentForm(EMPTY_ASSIGNMENT_FORM);
      setAssetCustomerResults([]);
      setMessage("Asset linked to customer.");
      await loadSnapshot(false);
    } catch (err) {
      setError(err?.message || "Failed to link asset");
    } finally {
      setBusyAction("");
    }
  };

  const unassignAsset = async (asset) => {
    if (!asset?._id) return;
    if (!window.confirm(`Unassign ${asset.assetTag} from ${asset.assignedCustomer?.name || "this customer"}?`)) {
      return;
    }
    setBusyAction(`asset:unassign:${asset._id}`);
    setMessage("");
    try {
      await api.post(`/service-ops/assets/${asset._id}/unassign-customer`, {});
      setMessage("Asset unassigned.");
      await loadSnapshot(false);
    } catch (err) {
      setError(err?.message || "Failed to unassign asset");
    } finally {
      setBusyAction("");
    }
  };

  const submitPool = async (event) => {
    event.preventDefault();
    setBusyAction("pool:create");
    setMessage("");
    try {
      await api.post("/service-ops/ip-pools", {
        ...poolForm,
        dnsServers: poolForm.dnsServers
          ? poolForm.dnsServers.split(",").map((item) => item.trim()).filter(Boolean)
          : [],
      });
      setPoolForm(EMPTY_POOL_FORM);
      setMessage("IP pool created.");
      await loadSnapshot(false);
    } catch (err) {
      setError(err?.message || "Failed to create IP pool");
    } finally {
      setBusyAction("");
    }
  };

  const submitIpAllocation = async (event) => {
    event.preventDefault();
    if (!ipForm.poolId) {
      setError("Choose a pool before allocating an address.");
      return;
    }
    if (ipForm.purpose === "customer-wan" && !ipForm.customerId) {
      setError("Choose a customer for customer WAN allocations.");
      return;
    }
    if (ipForm.purpose === "device-management" && !ipForm.assetId) {
      setError("Choose an asset for device management allocations.");
      return;
    }

    setBusyAction("ip:allocate");
    setMessage("");
    try {
      await api.post(`/service-ops/ip-pools/${ipForm.poolId}/allocate`, {
        purpose: ipForm.purpose,
        customerId: ipForm.customerId || undefined,
        assetId: ipForm.assetId || undefined,
        ipAddress: ipForm.ipAddress || undefined,
        note: ipForm.note || undefined,
      });
      setIpForm(EMPTY_IP_FORM);
      setIpCustomerResults([]);
      setMessage("IP address allocated.");
      await loadSnapshot(false);
    } catch (err) {
      setError(err?.message || "Failed to allocate IP address");
    } finally {
      setBusyAction("");
    }
  };

  const releaseAssignment = async (assignment) => {
    if (!assignment?._id) return;
    const reason = window.prompt("Release reason", "Released by operator");
    if (reason === null) return;
    setBusyAction(`ip:release:${assignment._id}`);
    setMessage("");
    try {
      await api.post(`/service-ops/ip-assignments/${assignment._id}/release`, {
        reason: reason.trim() || "Released by operator",
      });
      setMessage(`Released ${assignment.ipAddress}.`);
      await loadSnapshot(false);
    } catch (err) {
      setError(err?.message || "Failed to release IP assignment");
    } finally {
      setBusyAction("");
    }
  };

  if (status === "unknown") {
    return <div style={{ padding: 20 }}>Checking session...</div>;
  }
  if (status !== "auth") {
    return <div style={{ padding: 20 }}>Please log in to manage inventory and IPAM.</div>;
  }
  if (!canManage) {
    return <div style={{ padding: 20 }}>Service operations are limited to tenant owners and admins.</div>;
  }

  return (
    <div
      style={{
        padding: 20,
        display: "grid",
        gap: 20,
        background: "linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)",
        minHeight: "100%",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <SummaryCard title="Inventory Assets" value={summary?.totalAssets ?? "-"} accent="#0f172a" hint={`${summary?.assignedAssets ?? 0} assigned`} />
        <SummaryCard title="Active Pools" value={summary?.activePools ?? "-"} accent="#1d4ed8" hint={`${summary?.totalPools ?? 0} total pools`} />
        <SummaryCard title="Free Addresses" value={summary?.freeHosts ?? "-"} accent="#166534" hint={`${summary?.allocatedHosts ?? 0} allocated`} />
        <SummaryCard title="Live Assignments" value={summary?.activeAssignments ?? "-"} accent="#92400e" hint={`${summary?.reservedHosts ?? 0} reserved`} />
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
        title="Inventory Assets"
        subtitle="Track customer CPE, routers, radios, and other field equipment."
        actions={
          <button type="button" className="secondary" onClick={() => loadSnapshot(false)} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        }
      >
        <form onSubmit={submitAsset} className="stacked-form" style={{ padding: 0, marginBottom: 18 }}>
          <div className="field">
            <input name="assetTag" value={assetForm.assetTag} onChange={handleAssetChange} placeholder="Asset tag" required />
          </div>
          <div className="field">
            <input name="name" value={assetForm.name} onChange={handleAssetChange} placeholder="Display name" required />
          </div>
          <div className="field">
            <select name="kind" value={assetForm.kind} onChange={handleAssetChange}>
              <option value="cpe">CPE</option>
              <option value="router">Router</option>
              <option value="switch">Switch</option>
              <option value="radio">Radio</option>
              <option value="onu">ONU</option>
              <option value="ap">Access Point</option>
              <option value="server">Server</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="field">
            <select name="status" value={assetForm.status} onChange={handleAssetChange}>
              <option value="in_stock">In Stock</option>
              <option value="spare">Spare</option>
              <option value="maintenance">Maintenance</option>
              <option value="faulty">Faulty</option>
              <option value="retired">Retired</option>
            </select>
          </div>
          <div className="field">
            <input name="vendor" value={assetForm.vendor} onChange={handleAssetChange} placeholder="Vendor" />
          </div>
          <div className="field">
            <input name="model" value={assetForm.model} onChange={handleAssetChange} placeholder="Model" />
          </div>
          <div className="field">
            <input name="serialNumber" value={assetForm.serialNumber} onChange={handleAssetChange} placeholder="Serial number" />
          </div>
          <div className="field">
            <input name="macAddress" value={assetForm.macAddress} onChange={handleAssetChange} placeholder="MAC address" />
          </div>
          <div className="field">
            <input name="site" value={assetForm.site} onChange={handleAssetChange} placeholder="Site" />
          </div>
          <div className="field">
            <input name="location" value={assetForm.location} onChange={handleAssetChange} placeholder="Location / shelf / zone" />
          </div>
          <div className="field" style={{ gridColumn: "span 3" }}>
            <input name="notes" value={assetForm.notes} onChange={handleAssetChange} placeholder="Notes" />
          </div>
          <button type="submit" className="primary" disabled={busyAction === "asset:create"}>
            {busyAction === "asset:create" ? "Saving..." : "Add Asset"}
          </button>
        </form>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Customer</th>
                <th>Mgmt IP</th>
                <th>Site</th>
                <th>Live IPs</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {assets.length ? (
                assets.map((asset) => {
                  const badge = statusBadge(asset.status);
                  return (
                    <tr key={asset._id}>
                      <td>
                        <strong>{asset.assetTag}</strong>
                        <div style={{ marginTop: 4, color: "#64748b", fontSize: 13 }}>{asset.name}</div>
                      </td>
                      <td>{formatToken(asset.kind)}</td>
                      <td>
                        <span style={{ display: "inline-flex", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, ...badge }}>
                          {formatToken(asset.status)}
                        </span>
                      </td>
                      <td>
                        {asset.assignedCustomer ? (
                          <>
                            <strong>{asset.assignedCustomer.name}</strong>
                            <div style={{ marginTop: 4, color: "#64748b", fontSize: 13 }}>{asset.assignedCustomer.accountNumber || "-"}</div>
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>{asset.managementIp || "-"}</td>
                      <td>{asset.site || asset.location || "-"}</td>
                      <td>{asset.activeAssignmentCount || 0}</td>
                      <td className="actions" style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="secondary table-action"
                          onClick={() =>
                            setAssetAssignmentForm((current) => ({
                              ...current,
                              assetId: asset._id,
                            }))
                          }
                        >
                          Link Customer
                        </button>
                        {asset.assignedCustomer ? (
                          <button
                            type="button"
                            className="secondary table-action"
                            onClick={() => unassignAsset(asset)}
                            disabled={busyAction === `asset:unassign:${asset._id}`}
                          >
                            {busyAction === `asset:unassign:${asset._id}` ? "Working..." : "Unassign"}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center" }}>No inventory assets yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Asset Assignment" subtitle="Link field assets to customer accounts as they are installed.">
        <form onSubmit={submitAssetAssignment} className="stacked-form" style={{ padding: 0 }}>
          <div className="field">
            <select name="assetId" value={assetAssignmentForm.assetId} onChange={handleAssignmentChange}>
              <option value="">Choose asset</option>
              {assetOptions.map((asset) => (
                <option key={asset._id} value={asset._id}>
                  {asset.assetTag} | {asset.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ position: "relative" }}>
            <input
              name="customerQuery"
              value={assetAssignmentForm.customerQuery}
              onChange={handleAssignmentChange}
              placeholder="Search customer by name or account number"
            />
            {assetCustomerLoading ? <div className="help-text">Searching...</div> : null}
            <CustomerSearchResults
              results={assetCustomerResults}
              onSelect={(customer) => {
                setAssetAssignmentForm((current) => ({
                  ...current,
                  customerId: customer._id,
                  customerQuery: `${customer.name} (${customer.accountNumber || "N/A"})`,
                  customerLabel: customer.name || "",
                }));
                setAssetCustomerResults([]);
              }}
            />
          </div>
          <div className="field">
            <input type="date" name="installedAt" value={assetAssignmentForm.installedAt} onChange={handleAssignmentChange} />
            <p className="help-text">Optional install date.</p>
          </div>
          <div className="field" style={{ gridColumn: "span 2" }}>
            <input name="notes" value={assetAssignmentForm.notes} onChange={handleAssignmentChange} placeholder="Install or handover notes" />
          </div>
          <button type="submit" className="primary" disabled={busyAction === "asset:assign"}>
            {busyAction === "asset:assign" ? "Linking..." : "Link Asset"}
          </button>
        </form>
      </SectionCard>

      <SectionCard title="IP Pools" subtitle="Manage static, management, and infrastructure address pools.">
        <form onSubmit={submitPool} className="stacked-form" style={{ padding: 0, marginBottom: 18 }}>
          <div className="field">
            <input name="name" value={poolForm.name} onChange={handlePoolChange} placeholder="Pool name" required />
          </div>
          <div className="field">
            <input name="cidr" value={poolForm.cidr} onChange={handlePoolChange} placeholder="CIDR (e.g. 192.168.20.0/24)" required />
          </div>
          <div className="field">
            <select name="kind" value={poolForm.kind} onChange={handlePoolChange}>
              <option value="static">Static WAN</option>
              <option value="management">Management</option>
              <option value="infrastructure">Infrastructure</option>
              <option value="pppoe">PPPoE</option>
              <option value="hotspot">Hotspot</option>
              <option value="loopback">Loopback</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="field">
            <input name="gateway" value={poolForm.gateway} onChange={handlePoolChange} placeholder="Gateway IP" />
          </div>
          <div className="field">
            <input name="dnsServers" value={poolForm.dnsServers} onChange={handlePoolChange} placeholder="DNS servers (comma separated)" />
          </div>
          <div className="field">
            <input name="vlanId" type="number" value={poolForm.vlanId} onChange={handlePoolChange} placeholder="VLAN ID" />
          </div>
          <div className="field">
            <input name="site" value={poolForm.site} onChange={handlePoolChange} placeholder="Site" />
          </div>
          <div className="field">
            <select name="status" value={poolForm.status} onChange={handlePoolChange}>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
          <div className="field" style={{ gridColumn: "span 2" }}>
            <input name="notes" value={poolForm.notes} onChange={handlePoolChange} placeholder="Notes" />
          </div>
          <button type="submit" className="primary" disabled={busyAction === "pool:create"}>
            {busyAction === "pool:create" ? "Saving..." : "Add Pool"}
          </button>
        </form>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Pool</th>
                <th>Kind</th>
                <th>Gateway</th>
                <th>Status</th>
                <th>Usage</th>
                <th>Site</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pools.length ? (
                pools.map((pool) => {
                  const badge = statusBadge(pool.status);
                  return (
                    <tr key={pool._id}>
                      <td>
                        <strong>{pool.name}</strong>
                        <div style={{ marginTop: 4, color: "#64748b", fontSize: 13 }}>{poolDescriptor(pool)}</div>
                      </td>
                      <td>{formatToken(pool.kind)}</td>
                      <td>{pool.gateway || "-"}</td>
                      <td>
                        <span style={{ display: "inline-flex", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, ...badge }}>
                          {formatToken(pool.status)}
                        </span>
                      </td>
                      <td>
                        {pool.usage
                          ? `${pool.usage.allocatedCount + pool.usage.reservedCount}/${pool.usage.usableHostCount} used | ${pool.usage.freeCount} free`
                          : "-"}
                      </td>
                      <td>{pool.site || "-"}</td>
                      <td className="actions" style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="secondary table-action"
                          onClick={() =>
                            setIpForm((current) => ({
                              ...current,
                              poolId: pool._id,
                            }))
                          }
                        >
                          Allocate
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center" }}>No IP pools yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="IP Allocation" subtitle="Allocate addresses to customer WANs, device management interfaces, or reserve them for infrastructure.">
        <form onSubmit={submitIpAllocation} className="stacked-form" style={{ padding: 0 }}>
          <div className="field">
            <select name="poolId" value={ipForm.poolId} onChange={handleIpFormChange}>
              <option value="">Choose pool</option>
              {activePoolOptions.map((pool) => (
                <option key={pool._id} value={pool._id}>
                  {pool.name} | {poolDescriptor(pool)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <select name="purpose" value={ipForm.purpose} onChange={handleIpFormChange}>
              <option value="customer-wan">Customer WAN</option>
              <option value="device-management">Device Management</option>
              <option value="gateway">Gateway</option>
              <option value="infrastructure">Infrastructure</option>
              <option value="hotspot">Hotspot</option>
              <option value="reserved">Reserved</option>
            </select>
          </div>
          <div className="field">
            <input name="ipAddress" value={ipForm.ipAddress} onChange={handleIpFormChange} placeholder="Preferred IP (optional)" />
            <p className="help-text">Leave empty to auto-assign the next free host.</p>
          </div>

          <div className="field" style={{ position: "relative" }}>
            <input
              name="customerQuery"
              value={ipForm.customerQuery}
              onChange={handleIpFormChange}
              placeholder="Customer search (for WAN allocation)"
            />
            {ipCustomerLoading ? <div className="help-text">Searching...</div> : null}
            <CustomerSearchResults
              results={ipCustomerResults}
              onSelect={(customer) => {
                setIpForm((current) => ({
                  ...current,
                  customerId: customer._id,
                  customerQuery: `${customer.name} (${customer.accountNumber || "N/A"})`,
                  customerLabel: customer.name || "",
                }));
                setIpCustomerResults([]);
              }}
            />
          </div>

          <div className="field">
            <select name="assetId" value={ipForm.assetId} onChange={handleIpFormChange}>
              <option value="">No asset selected</option>
              {assetOptions.map((asset) => (
                <option key={asset._id} value={asset._id}>
                  {asset.assetTag} | {asset.name}
                </option>
              ))}
            </select>
            <p className="help-text">Required for device management allocations.</p>
          </div>

          <div className="field" style={{ gridColumn: "span 2" }}>
            <input name="note" value={ipForm.note} onChange={handleIpFormChange} placeholder="Purpose / reservation note" />
          </div>
          <button type="submit" className="primary" disabled={busyAction === "ip:allocate"}>
            {busyAction === "ip:allocate" ? "Allocating..." : "Allocate IP"}
          </button>
        </form>
      </SectionCard>

      <SectionCard title="IP Assignments" subtitle="Review active and recently released address assignments across customers and field assets.">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>IP Address</th>
                <th>Pool</th>
                <th>Purpose</th>
                <th>Customer</th>
                <th>Asset</th>
                <th>Status</th>
                <th>Allocated</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {assignments.length ? (
                assignments.map((assignment) => {
                  const badge = statusBadge(assignment.status);
                  return (
                    <tr key={assignment._id}>
                      <td>
                        <strong>{assignment.ipAddress}</strong>
                        {assignment.note ? (
                          <div style={{ marginTop: 4, color: "#64748b", fontSize: 13 }}>{assignment.note}</div>
                        ) : null}
                      </td>
                      <td>
                        {assignment.pool?.name || "-"}
                        <div style={{ marginTop: 4, color: "#64748b", fontSize: 13 }}>{assignment.pool?.cidr || "-"}</div>
                      </td>
                      <td>{formatToken(assignment.purpose)}</td>
                      <td>
                        {assignment.customer ? (
                          <>
                            <strong>{assignment.customer.name}</strong>
                            <div style={{ marginTop: 4, color: "#64748b", fontSize: 13 }}>{assignment.customer.accountNumber || "-"}</div>
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>
                        {assignment.asset ? (
                          <>
                            <strong>{assignment.asset.assetTag}</strong>
                            <div style={{ marginTop: 4, color: "#64748b", fontSize: 13 }}>{assignment.asset.name || "-"}</div>
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>
                        <span style={{ display: "inline-flex", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, ...badge }}>
                          {formatToken(assignment.status)}
                        </span>
                      </td>
                      <td>{formatDateTime(assignment.allocatedAt)}</td>
                      <td className="actions" style={{ textAlign: "right" }}>
                        {assignment.releasedAt == null ? (
                          <button
                            type="button"
                            className="secondary table-action"
                            onClick={() => releaseAssignment(assignment)}
                            disabled={busyAction === `ip:release:${assignment._id}`}
                          >
                            {busyAction === `ip:release:${assignment._id}` ? "Releasing..." : "Release"}
                          </button>
                        ) : (
                          <span style={{ color: "#64748b", fontSize: 13 }}>
                            Released {formatDateTime(assignment.releasedAt)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center" }}>No IP assignments yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {loading ? (
          <div style={{ marginTop: 12, color: "#64748b", fontSize: 14 }}>Loading service operations data...</div>
        ) : null}
        {!loading && !activeAssignments.length ? (
          <div style={{ marginTop: 12, color: "#64748b", fontSize: 14 }}>
            No active address assignments yet. Start by creating a pool and allocating your first IP.
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}
