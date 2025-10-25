import React, { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/apiClient";
import "./Login.css";

export default function AccountSettings() {
  const { user } = useAuth();
  const [email, setEmail] = useState(user?.email || "");
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [busyEmail, setBusyEmail] = useState(false);
  const [busyPw, setBusyPw] = useState(false);
  const [msgEmail, setMsgEmail] = useState("");
  const [msgPw, setMsgPw] = useState("");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");

  // Tenant subdomain management (moved from Payment Integration)
  const [subdomain, setSubdomain] = useState("");
  const [subMsg, setSubMsg] = useState("");
  const [savingSub, setSavingSub] = useState(false);

  // Tenant account number prefix
  const [prefix, setPrefix] = useState("");
  const [prefixMsg, setPrefixMsg] = useState("");

  // Tenant static IP pool
  const [poolText, setPoolText] = useState("");
  const [poolMsg, setPoolMsg] = useState("");
  const [savingPool, setSavingPool] = useState(false);

  async function saveProfile(e) {
    e.preventDefault();
    setMsgEmail("");
    setBusyEmail(true);
    try {
      await api.put("/account/email", { email, displayName });
      setMsgEmail("Profile updated successfully.");
    } catch (e) {
      setMsgEmail(e?.message || "Failed to update profile");
    } finally {
      setBusyEmail(false);
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    setMsgPw("");
    if (newPw !== newPw2 || newPw.length < 8) {
      setMsgPw("Passwords do not match or too short.");
      return;
    }
    setBusyPw(true);
    try {
      await api.put("/account/password", { currentPassword: currentPw, newPassword: newPw });
      setMsgPw("Password changed successfully.");
      setCurrentPw("");
      setNewPw("");
      setNewPw2("");
    } catch (e) {
      setMsgPw(e?.message || "Failed to change password");
    } finally {
      setBusyPw(false);
    }
  }

  useEffect(() => {
    async function loadTenant() {
      try {
        const { data } = await api.get("/tenant/me");
        setSubdomain(data?.subdomain || "");
        setPrefix(data?.accountPrefix || "");
        const list = Array.isArray(data?.staticIpPool) ? data.staticIpPool : [];
        setPoolText(list.join("\n"));
        setSubMsg("");
      } catch (e) {
        setSubMsg(e?.message || "Failed to load tenant");
      }
    }
    loadTenant();
  }, []);

  async function saveSubdomain(e) {
    e.preventDefault();
    setSavingSub(true);
    setSubMsg("");
    try {
      const { data } = await api.put("/tenant/subdomain", { subdomain });
      setSubMsg(data?.url ? `Saved. URL: ${data.url}` : "Saved");
    } catch (e) {
      setSubMsg(`Failed: ${e?.message || "Save error"}`);
    } finally {
      setSavingSub(false);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '24px auto', padding: '0 16px' }}>
      <h2 style={{ marginTop: 0 }}>Account Settings</h2>

      <form onSubmit={saveSubdomain} className="space-y-3" aria-label="Tenant Subdomain">
        <h3 style={{ margin: 0 }}>Tenant Subdomain</h3>
        <p className="helper-text">Set your subdomain (e.g., "acme" → acme.your-root-domain)</p>
        <input
          type="text"
          value={subdomain}
          onChange={(e) => setSubdomain(e.target.value.toLowerCase())}
          placeholder="subdomain"
          required
        />
        <button type="submit" disabled={savingSub}>{savingSub ? 'Saving…' : 'Save subdomain'}</button>
        {subMsg && (
          <div className="helper-text" style={{ color: subMsg.startsWith('Failed') ? '#ef4444' : '#16a34a' }}>{subMsg}</div>
        )}
      </form>

      <form onSubmit={async (e) => {
        e.preventDefault();
        setPoolMsg("");
        setSavingPool(true);
        try {
          const payload = { pool: poolText };
          const { data } = await api.put('/tenant/static/ip-pool', payload);
          const saved = Array.isArray(data?.staticIpPool) ? data.staticIpPool : [];
          setPoolText(saved.join('\n'));
          setPoolMsg(`Saved ${saved.length} IPv4 addresses`);
        } catch (e) {
          setPoolMsg(e?.message || 'Failed to save static IP pool');
        } finally {
          setSavingPool(false);
        }
      }} className="space-y-3" aria-label="Static IP Pool">
        <h3 style={{ margin: 0 }}>Static IP Pool</h3>
        <p className="helper-text">
          Provide a list of IPv4 addresses (one per line). When creating a static customer and leaving the IP empty,
          the system auto-assigns the first unused IP from this pool.
        </p>
        <textarea
          value={poolText}
          onChange={(e) => setPoolText(e.target.value)}
          placeholder={"e.g.\n192.168.10.10\n192.168.10.11\n192.168.10.12"}
          rows={8}
          style={{ width: '100%', fontFamily: 'monospace' }}
        />
        <button type="submit" disabled={savingPool}>{savingPool ? 'Saving…' : 'Save pool'}</button>
        {poolMsg && (
          <div className="helper-text" style={{ color: poolMsg.startsWith('Failed') ? '#ef4444' : '#16a34a' }}>{poolMsg}</div>
        )}
      </form>

      <form onSubmit={async (e) => {
        e.preventDefault();
        setPrefixMsg("");
        try {
          await api.put('/tenant/account/prefix', { prefix });
          setPrefixMsg('Prefix saved');
        } catch (e) {
          setPrefixMsg(e?.message || 'Failed to save prefix');
        }
      }} className="space-y-3" aria-label="Account Number Prefix">
        <h3 style={{ margin: 0 }}>Account Number Prefix</h3>
        <p className="helper-text">Optional prefix prepended to generated account numbers (e.g., FML- or FUNNET-)</p>
        <input
          type="text"
          value={prefix}
          onChange={(e) => setPrefix(e.target.value.toUpperCase())}
          placeholder="e.g., FML-"
        />
        <button type="submit">Save prefix</button>
        {prefixMsg && (
          <div className="helper-text" style={{ color: prefixMsg.startsWith('Failed') ? '#ef4444' : '#16a34a' }}>{prefixMsg}</div>
        )}
      </form>

      <form onSubmit={saveProfile} className="space-y-3" aria-label="Profile">
        <h3 style={{ margin: 0 }}>Profile</h3>
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" />
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
        <button type="submit" disabled={busyEmail}>{busyEmail ? 'Saving…' : 'Save profile'}</button>
        {msgEmail && (
          <div className="helper-text" style={{ color: msgEmail.includes('success') ? '#16a34a' : '#ef4444' }}>{msgEmail}</div>
        )}
      </form>

      <form onSubmit={changePassword} className="space-y-3" aria-label="Password">
        <h3 style={{ margin: 0 }}>Change Password</h3>
        <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="Current password" />
        <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="New password (min 8 chars)" />
        <input type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} placeholder="Confirm new password" />
        <button type="submit" disabled={busyPw}>{busyPw ? 'Saving…' : 'Change password'}</button>
        {msgPw && (
          <div className="helper-text" style={{ color: msgPw.includes('success') ? '#16a34a' : '#ef4444' }}>{msgPw}</div>
        )}
      </form>
    </div>
  );
}
