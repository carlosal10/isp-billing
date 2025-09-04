// src/components/ConnectMikrotikModal.jsx
import React, { useMemo, useState } from "react";
import { FaTimes } from "react-icons/fa";
import { api } from "../lib/apiClient";
import "./ConnectMikrotikModal.css";

function loadAuth() {
  try {
    return JSON.parse(localStorage.getItem("auth") || "null");
  } catch {
    return null;
  }
}

export default function ConnectMikrotikModal({ isOpen, onClose }) {
  const [form, setForm] = useState({ host: "", port: 8728, user: "", password: "", tls: false });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const saved = loadAuth();
  const token = saved?.accessToken || null;
  const ispId = saved?.ispId || null;

  const debugSent = useMemo(() => {
    return `sending headers → Authorization: ${token ? "yes" : "no"}, x-isp-id: ${ispId || "(none)"}`;
  }, [token, ispId]);

  if (!isOpen) return null;

  const onChange = (e) => {
    const { id, type, value, checked } = e.target;
    setForm((f) => ({ ...f, [id]: type === "checkbox" ? checked : value }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setMsg("");
    setLoading(true);
    try {
      const { data } = await api.post(
        "/connect",
        {
          host: form.host.trim(),
          port: Number(form.port) || (form.tls ? 8729 : 8728),
          user: form.user.trim(),
          password: form.password,
          tls: !!form.tls,
        },
        {
          // Force headers in case interceptors aren't wired yet
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(ispId ? { "x-isp-id": ispId } : {}),
          },
        }
      );

      if (!data?.ok) throw new Error(data?.error || "Connection failed");
      setMsg(`Connected: ${data.identity || "ok"}`);
      // Auto-close shortly after success
      setTimeout(() => {
        try {
          onClose && onClose();
        } catch {}
      }, 800);
    } catch (err) {
      setMsg("Failed: " + (err?.message || "Connection failed"));
      console.error("Connect error:", err?.__debug || err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mikrotik-overlay">
      <div className="mikrotik-modal">
        <button onClick={onClose} className="close-btn">
          <FaTimes size={20} />
        </button>
        <h2 className="modal-title">Connect To MikroTik</h2>

        <form onSubmit={onSubmit} className="modal-form">
          <label>
            Router IP:
            <input id="host" value={form.host} onChange={onChange} required />
          </label>
          <label>
            Port:
            <input id="port" type="number" value={form.port} onChange={onChange} />
          </label>
          <label>
            Username:
            <input id="user" value={form.user} onChange={onChange} required />
          </label>
          <label>
            Password:
            <input id="password" type="password" value={form.password} onChange={onChange} required />
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input id="tls" type="checkbox" checked={form.tls} onChange={onChange} />
            Use TLS (8729)
          </label>

          <button type="submit" disabled={loading} className="submit-btn">
            {loading ? "Connecting..." : "Connect"}
          </button>
        </form>

        <div className="response-msg" style={{ opacity: 0.8, fontSize: 12 }}>{debugSent}</div>
        {msg && <div className="response-msg">{msg}</div>}
      </div>
    </div>
  );
}

