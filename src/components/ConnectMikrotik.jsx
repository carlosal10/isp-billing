import React, { useState } from "react";
import { FaTimes } from "react-icons/fa";
import { api } from "../lib/apiClient";          // ← use shared axios (adds Authorization + x-isp-id)
import "./ConnectMikrotikModal.css";

export default function ConnectMikrotikModal({ isOpen, onClose }) {
  const [form, setForm] = useState({ host: "", port: 8728, user: "", password: "", tls: false });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  if (!isOpen) return null;

  const onChange = (e) => {
    const { id, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [id]: type === "checkbox" ? checked : value }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMsg("");
    try {
      const { data } = await api.post("/connect", {
        host: form.host.trim(),
        port: Number(form.port) || (form.tls ? 8729 : 8728),
        user: form.user.trim(),
        password: form.password,
        tls: !!form.tls,
      });
      if (!data?.ok) throw new Error(data?.error || "Connection failed");
      setMsg(`✅ Connected: ${data.identity || "ok"}`);
    } catch (err) {
      setMsg("❌ " + (err?.message || "Connection failed"));
      // Optional deep debug: console.error(err.__debug || err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mikrotik-overlay">
      <div className="mikrotik-modal">
        <button onClick={onClose} className="close-btn"><FaTimes size={20} /></button>
        <h2 className="modal-title">Connect To MikroTik</h2>

        <form onSubmit={onSubmit} className="modal-form">
          <label>Router IP:
            <input id="host" value={form.host} onChange={onChange} required />
          </label>

          <label>Port:
            <input id="port" type="number" value={form.port} onChange={onChange} />
          </label>

          <label>Username:
            <input id="user" value={form.user} onChange={onChange} required />
          </label>

          <label>Password:
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

        {msg && <div className="response-msg">{msg}</div>}
      </div>
    </div>
  );
        }      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || "Connection failed");

      setResponse(data.message); // ✅ show actual router name from backend
    } catch (err) {
      setResponse("❌ " + err.message);
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

        <form onSubmit={handleSubmit} className="modal-form">
          <label>
            Router IP:
            <input
              type="text"
              id="host"
              value={formData.host}
              onChange={handleChange}
              required
            />
          </label>

          <label>
            Username:
            <input
              type="text"
              id="user"
              value={formData.user}
              onChange={handleChange}
              required
            />
          </label>

          <label>
            Password:
            <input
              type="password"
              id="password"
              value={formData.password}
              onChange={handleChange}
              required
            />
          </label>

          <button type="submit" disabled={loading} className="submit-btn">
            {loading ? "Connecting..." : "Connect"}
          </button>
        </form>

        {response && <div className="response-msg">{response}</div>}
      </div>
    </div>
  );
}
