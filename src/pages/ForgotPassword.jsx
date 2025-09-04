import React, { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/apiClient";
import "./Login.css";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit(e) {
    e.preventDefault();
    setMsg("");
    setBusy(true);
    try {
      // Attempt to call backend if present; otherwise still show UX success
      await api.post("/auth/forgot-password", { email });
      setMsg("If an account exists for this email, a reset link has been sent.");
    } catch {
      setMsg("If an account exists for this email, a reset link has been sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Forgot password">
      <h2 style={{ margin: 0 }}>Forgot password</h2>
      <p className="helper-text">Enter your account email to receive a reset link.</p>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        autoComplete="email"
      />
      <button type="submit" disabled={busy || !/\S+@\S+\.\S+/.test(email)}>
        {busy ? "Sending…" : "Send reset link"}
      </button>
      {msg && <div className="helper-text" style={{ color: "#16a34a" }}>{msg}</div>}
      <div className="helper-text">
        Remembered it? <Link to="/login">Back to login</Link>
      </div>
    </form>
  );
}

