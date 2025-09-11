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
      await api.post("/auth/forgot-password", { email });
      setMsg("If an account exists for this email, a reset link has been sent.");
    } catch {
      setMsg("If an account exists for this email, a reset link has been sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell" aria-label="Forgot password">
      <section
        className="login-left"
        aria-labelledby="forgot-title"
        style={{
          background:
            "radial-gradient(1200px 380px at 80% -10%, rgba(230,57,70,.20), transparent 60%)," +
            "radial-gradient(900px 320px at 0% 30%, rgba(241,196,15,.18), transparent 60%)," +
            "linear-gradient(180deg, rgba(11,37,69,.93), rgba(11,37,69,.82))," +
            "url('/images/login/hero.jpg')",
        }}
      >
        <div className="login-left-inner">
          <span className="login-chip">KT-SwiftBridge</span>
          <h1 id="forgot-title" className="login-title">Recover access.</h1>
          <p className="login-sub">We’ll email you a secure link to reset your password.</p>
        </div>
        <div className="login-ambient" aria-hidden="true" />
      </section>

      <section className="login-right">
        <form onSubmit={submit} className="login-form" aria-label="Forgot password form">
          <h2 style={{ margin: 0, color: "#0B2545" }}>Forgot password</h2>
          <p className="helper-text">Enter your account email to receive a reset link.</p>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            autoComplete="email"
            className="input"
          />
          <button type="submit" className="btn-primary" disabled={busy || !/\S+@\S+\.\S+/.test(email)}>
            {busy ? "Sending..." : "Send reset link"}
          </button>
          {msg && <div className="alert success" role="status">{msg}</div>}
          <div className="form-links">
            Remembered it? <Link to="/login">Back to login</Link>
          </div>
        </form>
      </section>
    </main>
  );
}

