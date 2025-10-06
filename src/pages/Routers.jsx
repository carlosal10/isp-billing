// src/pages/Routers.jsx
import React, { useMemo, useState } from "react";
import { api } from "../lib/apiClient";
import { useAuth } from "../context/AuthContext";
import { useServer } from "../context/ServerContext";

function getId(s) {
  return String(s?.id ?? s?._id ?? s?.serverId ?? "");
}
function Row({ s, onPrimary, onTest, onDelete }) {
  return (
    <tr>
      <td>{s.primary ? "★" : ""} {s.name}</td>
      <td>{s.host}:{s.port}</td>
      <td>{s.tls ? "yes" : "no"}</td>
      <td>{s.site || "-"}</td>
      <td>{s.lastVerifiedAt ? new Date(s.lastVerifiedAt).toLocaleString() : "-"}</td>
      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        {!s.primary && (
          <button onClick={() => onPrimary(s)} title="Make primary">Primary</button>
        )}
        <button onClick={() => onTest(s)} style={{ marginLeft: 8 }}>Test</button>
        <button onClick={() => onDelete(s)} style={{ marginLeft: 8 }} className="danger">
          Delete
        </button>
      </td>
    </tr>
  );
}

export default function Routers() {
  const { status } = useAuth();                // "unknown" | "guest" | "auth"
  const { servers, reload } = useServer();     // from ServerProvider
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({
    name: "default",
    host: "",
    port: 8728,
    username: "",
    password: "",
    tls: false,
    primary: true,
    site: "",
  });

  const items = useMemo(() => Array.isArray(servers) ? servers : [], [servers]);

  const onChange = (e) => {
    const { id, type, value, checked } = e.target;
    setForm((f) => ({ ...f, [id]: type === "checkbox" ? checked : value }));
  };

  const onCreate = async (e) => {
    e.preventDefault();
    setMsg(""); setError("");
    try {
      await api.post("/mikrotik/servers", {
        name: form.name.trim() || "default",
        host: form.host.trim(),
        port: Number(form.port) || (form.tls ? 8729 : 8728),
        username: form.username.trim(),
        password: form.password,
        tls: !!form.tls,
        primary: !!form.primary,
        site: form.site || undefined,
      });
      setMsg("Created");
      setForm((f) => ({ ...f, password: "" }));
      await reload();
    } catch (e2) {
      setError(e2?.message || "Create failed");
    }
  };

  const onPrimary = async (s) => {
    setMsg(""); setError("");
    try {
      await api.put(`/mikrotik/servers/${getId(s)}`, { primary: true });
      await reload();
    } catch (e2) {
      setError(e2?.message || "Failed to set primary");
    }
  };

  const onTest = async (s) => {
    setMsg(""); setError("");
    try {
      const { data } = await api.post(`/mikrotik/servers/${getId(s)}/test`);
      setMsg(`Server ${s.name}: ${data?.identity || "ok"}`);
      await reload();
    } catch (e2) {
      setError(e2?.message || "Test failed");
    }
  };

  const onDelete = async (s) => {
    if (!window.confirm(`Delete server ${s.name}?`)) return;
    setMsg(""); setError("");
    try {
      await api.delete(`/mikrotik/servers/${getId(s)}`);
      await reload();
    } catch (e2) {
      setError(e2?.message || "Delete failed");
    }
  };

  // ---- Auth gating (prevents "Missing token" calls) ----
  if (status === "unknown") {
    return <div style={{ padding: 16 }}>Checking session…</div>;
  }
  if (status !== "auth") {
    return <div style={{ padding: 16 }}>Please log in to manage MikroTik servers.</div>;
  }

  return (
    <div style={{ padding: 16 }}>
      <h1>MikroTik Servers</h1>
      {error && <div className="msg-err" role="alert">{error}</div>}
      {msg &&   <div className="msg-ok"  role="status">{msg}</div>}

      <form onSubmit={onCreate} className="stacked-form" style={{ maxWidth: 720, marginBottom: 20 }}>
        <h3>Add Server</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label>Name<input id="name" value={form.name} onChange={onChange} required /></label>
          <label>Site<input id="site" value={form.site} onChange={onChange} placeholder="Optional label" /></label>
          <label>Host<input id="host" value={form.host} onChange={onChange} required /></label>
          <label>Port<input id="port" type="number" value={form.port} onChange={onChange} /></label>
          <label>User<input id="username" value={form.username} onChange={onChange} required /></label>
          <label>Password<input id="password" type="password" value={form.password} onChange={onChange} required /></label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input id="tls" type="checkbox" checked={form.tls} onChange={onChange} /> TLS (8729)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input id="primary" type="checkbox" checked={form.primary} onChange={onChange} /> Set as primary
          </label>
        </div>
        <button type="submit" style={{ marginTop: 8 }}>Save</button>
      </form>

      <h3>Servers</h3>
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Address</th>
              <th>TLS</th>
              <th>Site</th>
              <th>Verified</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length > 0 ? (
              items.map((s) => (
                <Row key={getId(s)} s={s} onPrimary={onPrimary} onTest={onTest} onDelete={onDelete} />
              ))
            ) : (
              <tr><td colSpan={6} style={{ textAlign: "center" }}>No servers yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
