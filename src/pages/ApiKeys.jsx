import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/apiClient";
import { useAuth } from "../context/AuthContext";

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "-";
}

function toDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function scopeLabel(scope) {
  return String(scope || "")
    .split(":")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function statusTone(key) {
  if (key?.active) return { background: "#dcfce7", color: "#166534", label: "Active" };
  if (key?.isExpired) return { background: "#fef3c7", color: "#92400e", label: "Expired" };
  return { background: "#fee2e2", color: "#991b1b", label: "Revoked" };
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

function StatusBadge({ apiKey }) {
  const tone = statusTone(apiKey);
  return (
    <span style={{ borderRadius: 999, padding: "5px 10px", fontWeight: 800, background: tone.background, color: tone.color }}>
      {tone.label}
    </span>
  );
}

function ScopePicker({ scopes, selected, onToggle, disabled }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 10 }}>
      {scopes.map((scope) => {
        const checked = selected.includes(scope.key);
        return (
          <label
            key={scope.key}
            style={{
              border: `1px solid ${checked ? "#2563eb" : "#e2e8f0"}`,
              borderRadius: 14,
              padding: 12,
              background: checked ? "#eff6ff" : "#f8fafc",
              display: "grid",
              gap: 4,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            <span style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 800, color: "#0f172a" }}>
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => onToggle(scope.key)}
              />
              {scope.label || scopeLabel(scope.key)}
            </span>
            <span style={{ color: "#64748b", fontSize: 13 }}>{scope.description || scope.key}</span>
          </label>
        );
      })}
    </div>
  );
}

export default function ApiKeys() {
  const { role, status } = useAuth();
  const canManage = role === "owner" || role === "admin";
  const [keys, setKeys] = useState([]);
  const [scopes, setScopes] = useState([]);
  const [form, setForm] = useState({
    label: "",
    description: "",
    scopes: ["customers:read", "invoices:read", "payments:read"],
    expiresAt: "",
  });
  const [editingId, setEditingId] = useState("");
  const [editForm, setEditForm] = useState(null);
  const [oneTimeKey, setOneTimeKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const scopeMap = useMemo(
    () => new Map(scopes.map((scope) => [scope.key, scope])),
    [scopes]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [keysRes, scopesRes] = await Promise.all([
        api.get("/api-keys"),
        api.get("/api-keys/scopes"),
      ]);
      setKeys(Array.isArray(keysRes.data) ? keysRes.data : []);
      setScopes(Array.isArray(scopesRes.data) ? scopesRes.data : []);
    } catch (err) {
      setError(err?.message || "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status !== "auth" || !canManage) return;
    load();
  }, [canManage, load, status]);

  const toggleScope = (key, source, setter) => {
    setter((current) => {
      const next = new Set(current[source] || []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...current, [source]: Array.from(next) };
    });
  };

  const createKey = async (event) => {
    event.preventDefault();
    setBusy("create");
    setMessage("");
    setError("");
    setOneTimeKey(null);
    try {
      const { data } = await api.post("/api-keys", {
        ...form,
        expiresAt: form.expiresAt || null,
      });
      setOneTimeKey(data);
      setForm({
        label: "",
        description: "",
        scopes: ["customers:read", "invoices:read", "payments:read"],
        expiresAt: "",
      });
      setMessage("API key created. Copy the plaintext key now; it will not be shown again.");
      await load();
    } catch (err) {
      setError(err?.message || "Failed to create API key");
    } finally {
      setBusy("");
    }
  };

  const beginEdit = (apiKey) => {
    setEditingId(apiKey.id);
    setEditForm({
      label: apiKey.label || "",
      description: apiKey.description || "",
      scopes: Array.isArray(apiKey.scopes) ? apiKey.scopes : [],
      expiresAt: toDateInput(apiKey.expiresAt),
    });
  };

  const saveEdit = async (apiKey) => {
    if (!editForm) return;
    setBusy(`edit:${apiKey.id}`);
    setMessage("");
    setError("");
    try {
      await api.patch(`/api-keys/${apiKey.id}`, {
        ...editForm,
        expiresAt: editForm.expiresAt || null,
      });
      setEditingId("");
      setEditForm(null);
      setMessage("API key updated.");
      await load();
    } catch (err) {
      setError(err?.message || "Failed to update API key");
    } finally {
      setBusy("");
    }
  };

  const revokeKey = async (apiKey) => {
    const reason = window.prompt(`Reason for revoking ${apiKey.label || apiKey.prefix}?`, "");
    if (reason === null) return;
    setBusy(`revoke:${apiKey.id}`);
    setMessage("");
    setError("");
    try {
      await api.delete(`/api-keys/${apiKey.id}`, { params: { reason } });
      setMessage("API key revoked.");
      await load();
    } catch (err) {
      setError(err?.message || "Failed to revoke API key");
    } finally {
      setBusy("");
    }
  };

  const copyText = async (text, successMessage = "Copied.") => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(successMessage);
    } catch {
      setMessage(text);
    }
  };

  if (status === "unknown") return <div style={{ padding: 16 }}>Checking session...</div>;
  if (status !== "auth") return <div style={{ padding: 16 }}>Please log in to manage API keys.</div>;
  if (!canManage) return <div style={{ padding: 16 }}>API key management is limited to tenant owners and admins.</div>;

  return (
    <div
      style={{
        padding: 20,
        display: "grid",
        gap: 20,
        background: "linear-gradient(180deg, #f8fafc 0%, #f0fdfa 50%, #ecfeff 100%)",
        minHeight: "100%",
      }}
    >
      <header>
        <div style={{ color: "#0f766e", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>Integrations</div>
        <h1 style={{ margin: "6px 0 4px", color: "#0f172a", fontSize: 34 }}>API Keys</h1>
        <p style={{ margin: 0, color: "#475569", maxWidth: 820 }}>
          Issue scoped keys for integrations without sharing operator credentials. Plaintext keys are shown once.
        </p>
      </header>

      {message ? <div style={{ color: "#166534", fontWeight: 800 }}>{message}</div> : null}
      {error ? <div style={{ color: "#b91c1c", fontWeight: 800 }}>{error}</div> : null}

      {oneTimeKey?.plaintextKey ? (
        <SectionCard title="One-Time Secret" subtitle="Copy this key now. For safety, it cannot be retrieved again.">
          <div style={{ display: "grid", gap: 10 }}>
            <code style={{ background: "#0f172a", color: "#e2e8f0", borderRadius: 12, padding: 14, overflowX: "auto" }}>
              {oneTimeKey.plaintextKey}
            </code>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn" onClick={() => copyText(oneTimeKey.plaintextKey, "API key copied.")}>Copy Key</button>
              <button className="btn" style={{ background: "#64748b" }} onClick={() => setOneTimeKey(null)}>Dismiss</button>
            </div>
          </div>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Create API Key"
        subtitle="Start with the smallest scope set required by the integration."
        actions={<button className="btn" onClick={load} disabled={loading}>Refresh</button>}
      >
        <form onSubmit={createKey} style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
            <input
              value={form.label}
              onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
              placeholder="Label, e.g. CRM Sync"
              required
              style={{ padding: "11px 12px", border: "1px solid #cbd5e1", borderRadius: 12 }}
            />
            <input
              type="date"
              value={form.expiresAt}
              onChange={(event) => setForm((current) => ({ ...current, expiresAt: event.target.value }))}
              title="Optional expiry"
              style={{ padding: "11px 12px", border: "1px solid #cbd5e1", borderRadius: 12 }}
            />
          </div>
          <textarea
            value={form.description}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            placeholder="Description or system owner"
            rows={2}
            style={{ padding: "11px 12px", border: "1px solid #cbd5e1", borderRadius: 12 }}
          />
          <ScopePicker
            scopes={scopes}
            selected={form.scopes}
            onToggle={(scope) => toggleScope(scope, "scopes", setForm)}
          />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn" type="submit" disabled={busy === "create" || !form.scopes.length}>
              {busy === "create" ? "Creating..." : "Create Key"}
            </button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Issued Keys" subtitle={`${keys.length} integration key(s)`}>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Prefix</th>
                <th>Status</th>
                <th>Scopes</th>
                <th>Last Used</th>
                <th>Expires</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((apiKey) => {
                const editing = editingId === apiKey.id && editForm;
                return (
                  <React.Fragment key={apiKey.id}>
                    <tr>
                      <td>
                        <strong>{apiKey.label || "API Key"}</strong>
                        {apiKey.description ? <div style={{ color: "#64748b", fontSize: 13 }}>{apiKey.description}</div> : null}
                      </td>
                      <td><code>{apiKey.prefix || "-"}</code></td>
                      <td><StatusBadge apiKey={apiKey} /></td>
                      <td>{(apiKey.scopes || []).map((scope) => scopeMap.get(scope)?.label || scopeLabel(scope)).join(", ") || "-"}</td>
                      <td>{formatDateTime(apiKey.lastUsedAt)}</td>
                      <td>{formatDateTime(apiKey.expiresAt)}</td>
                      <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {apiKey.storedActive ? (
                          <>
                            <button className="btn" onClick={() => beginEdit(apiKey)}>Edit</button>
                            <button className="btn" style={{ background: "#ef4444" }} disabled={busy === `revoke:${apiKey.id}`} onClick={() => revokeKey(apiKey)}>
                              Revoke
                            </button>
                          </>
                        ) : (
                          <span style={{ color: "#64748b" }}>No actions</span>
                        )}
                      </td>
                    </tr>
                    {editing ? (
                      <tr>
                        <td colSpan={7}>
                          <div style={{ display: "grid", gap: 12, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 14, padding: 14 }}>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
                              <input
                                value={editForm.label}
                                onChange={(event) => setEditForm((current) => ({ ...current, label: event.target.value }))}
                                style={{ padding: "11px 12px", border: "1px solid #cbd5e1", borderRadius: 12 }}
                              />
                              <input
                                type="date"
                                value={editForm.expiresAt}
                                onChange={(event) => setEditForm((current) => ({ ...current, expiresAt: event.target.value }))}
                                style={{ padding: "11px 12px", border: "1px solid #cbd5e1", borderRadius: 12 }}
                              />
                            </div>
                            <textarea
                              value={editForm.description}
                              onChange={(event) => setEditForm((current) => ({ ...current, description: event.target.value }))}
                              rows={2}
                              style={{ padding: "11px 12px", border: "1px solid #cbd5e1", borderRadius: 12 }}
                            />
                            <ScopePicker
                              scopes={scopes}
                              selected={editForm.scopes}
                              onToggle={(scope) => toggleScope(scope, "scopes", setEditForm)}
                            />
                            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                              <button className="btn" style={{ background: "#64748b" }} onClick={() => { setEditingId(""); setEditForm(null); }}>Cancel</button>
                              <button className="btn" disabled={busy === `edit:${apiKey.id}` || !editForm.scopes.length} onClick={() => saveEdit(apiKey)}>
                                Save Changes
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
              {!keys.length ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 24 }}>{loading ? "Loading..." : "No API keys created yet"}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
