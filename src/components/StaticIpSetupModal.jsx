// src/components/StaticIpSetupModal.jsx
import React, { useEffect, useState } from "react";
import { FaTimes } from "react-icons/fa";
import { MdSecurity, MdBolt } from "react-icons/md";
import { api } from "../lib/apiClient";
import "./PppoeModal.css"; // reuse modal styles

export default function StaticIpSetupModal({ isOpen, onClose }) {
  const [bridge, setBridge] = useState("bridge1");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setMsg("");
    setSummary(null);
  }, [isOpen]);

  if (!isOpen) return null;

  async function runBootstrap(e) {
    e?.preventDefault?.();
    setLoading(true); setMsg(""); setSummary(null);
    try {
      const { data } = await api.post("/mikrotik/admin/bootstrap/static-ip", { bridge });
      if (!data?.ok) throw new Error(data?.error || "Bootstrap failed");
      setSummary(data.summary || {});
      setMsg("Setup complete");
    } catch (e) {
      setMsg(e?.message || "Failed to run setup");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <button className="close" onClick={onClose} aria-label="Close"><FaTimes /></button>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MdSecurity /> Setup Static‑IP Policy
        </h2>
        {msg && (
          <div className="status-msg" style={{ background: msg.includes("complete") ? "#ecfdf5" : undefined, borderColor: msg.includes("complete") ? "#bbf7d0" : undefined, color: msg.includes("complete") ? "#065f46" : undefined }}>
            {msg}
          </div>
        )}

        <form onSubmit={runBootstrap} style={{ gridTemplateColumns: '1fr auto auto' }}>
          <input
            placeholder="Bridge name (e.g. bridge1)"
            value={bridge}
            onChange={(e) => setBridge(e.target.value)}
            required
          />
          <button type="submit" disabled={loading}>
            <MdBolt className="inline-icon" /> {loading ? "Running..." : "Run Setup"}
          </button>
          <button type="button" className="remove-btn" onClick={onClose}>Close</button>
        </form>

        <div className="help" style={{ marginTop: 6 }}>
          This will:
          <ul>
            <li>Create address‑lists <b>STATIC_ALLOW</b> and <b>STATIC_BLOCK</b></li>
            <li>Add forward rules (EST/REL, allow paid statics, block unpaid statics, drop unknown from bridge)</li>
            <li>Disable DHCP servers bound to the bridge (PPPoE unaffected)</li>
          </ul>
        </div>

        {summary && (
          <div style={{ marginTop: 10 }}>
            <div className="help">Summary</div>
            <pre style={{ background: '#f8fafc', border: '1px solid #eef1f6', padding: 12, borderRadius: 12, maxHeight: 280, overflow: 'auto' }}>
{JSON.stringify(summary, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

