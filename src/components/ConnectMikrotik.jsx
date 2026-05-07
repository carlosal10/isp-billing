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

function verificationReason(reason) {
  if (reason === "auth") {
    return "authentication failed. Check the username, password, and RouterOS API permissions.";
  }
  if (reason === "connect") {
    return "the backend could not reach this router. If it is on a private LAN, run the backend on that network or expose it through a VPN/tunnel.";
  }
  if (reason === "no-identity") {
    return "the router replied, but did not return an identity.";
  }
  return "the router could not be verified.";
}

export default function ConnectMikrotikModal({ isOpen, onClose }) {
  const [form, setForm] = useState({
    name: "default",
    primary: true,
    host: "",
    port: 8728,
    user: "",
    password: "",
    tls: false,
  });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const saved = loadAuth();
  const token = saved?.accessToken || null;
  const ispId = saved?.ispId || null;

  const debugSent = useMemo(() => {
    return `sending headers -> Authorization: ${token ? "yes" : "no"}, x-isp-id: ${ispId || "(none)"}`;
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
          name: form.name.trim() || "default",
          primary: !!form.primary,
          host: form.host.trim(),
          port: Number(form.port) || (form.tls ? 8729 : 8728),
          user: form.user.trim(),
          password: form.password,
          tls: !!form.tls,
          timeoutMs: 12000,
        },
        {
          timeout: 45000,
          // Force headers in case interceptors aren't wired yet.
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(ispId ? { "x-isp-id": ispId } : {}),
          },
        }
      );

      if (!data?.ok) throw new Error(data?.error || "Connection failed");
      if (!data.verified) {
        setMsg(`Saved, but not verified: ${verificationReason(data.reason)}`);
        return;
      }

      setMsg(`Connected: ${data.identity || "ok"}`);
      setTimeout(() => {
        try {
          onClose && onClose();
        } catch {}
      }, 800);
    } catch (err) {
      const debug = err?.__debug || {};
      const isTimeout = debug.code === "ECONNABORTED" || /timeout/i.test(err?.message || debug.message || "");
      const noResponse = !debug.status && !err?.response;
      const message =
        isTimeout || noResponse
          ? "request timed out before the server responded. If this router is on a private LAN, the deployed backend cannot reach it unless the router is exposed through VPN/tunnel or the backend runs on that network."
          : err?.message || "Connection failed";
      setMsg("Failed: " + message);
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
            Name:
            <input id="name" value={form.name} onChange={onChange} required />
          </label>
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
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input id="primary" type="checkbox" checked={form.primary} onChange={onChange} />
            Set as primary
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
