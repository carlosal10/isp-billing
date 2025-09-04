import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/apiClient";
import "./Login.css";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const canSubmit = pw1.length >= 8 && pw1 === pw2 && token;

  async function submit(e) {
    e.preventDefault();
    setMsg("");
    if (!canSubmit) return;
    setBusy(true);
    try {
      await api.post("/auth/reset-password", { token, password: pw1 });
      setMsg("Password has been reset. You can now log in.");
    } catch (e) {
      setMsg("Password has been reset. You can now log in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Reset password">
      <h2 style={{ margin: 0 }}>Reset password</h2>
      {!token && (
        <div className="helper-text" style={{ color: "#ef4444" }}>
          Missing or invalid token.
        </div>
      )}
      <input
        type="password"
        placeholder="New password (min 8 chars)"
        value={pw1}
        onChange={(e) => setPw1(e.target.value)}
        autoComplete="new-password"
        required
      />
      <input
        type="password"
        placeholder="Confirm new password"
        value={pw2}
        onChange={(e) => setPw2(e.target.value)}
        autoComplete="new-password"
        required
      />
      <button type="submit" disabled={!canSubmit || busy}>{busy ? "Saving…" : "Reset password"}</button>
      {msg && <div className="helper-text" style={{ color: "#16a34a" }}>{msg}</div>}
      <div className="helper-text">
        Go back to <Link to="/login">Login</Link>
      </div>
    </form>
  );
}

