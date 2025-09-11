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
      // Keep the same message (avoids leaking token state)
      setMsg("Password has been reset. You can now log in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell" aria-label="Reset password">
      {/* Left pitch (keeps brand consistency) */}
      <section
        className="login-left"
        aria-labelledby="reset-title"
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
          <h1 id="reset-title" className="login-title">Security first.</h1>
          <p className="login-sub">
            Reset your password and get back to managing plans and payments with confidence.
          </p>
          <ul className="login-benefits">
            <li><span className="dot dot-green" /> Encrypted credentials</li>
            <li><span className="dot dot-amber" /> Secure account recovery</li>
            <li><span className="dot dot-blue" /> 24/7 support</li>
          </ul>
        </div>
        <div className="login-ambient" aria-hidden="true" />
      </section>

      {/* Right: Reset form */}
      <section className="login-right">
        <form onSubmit={submit} className="login-form" aria-label="Reset password form">
          <h2 style={{ margin: 0, color: "#0B2545" }}>Reset password</h2>

          {!token && (
            <div className="alert error" role="alert">
              Missing or invalid token.
            </div>
          )}

          <div className="form-grid" style={{ marginTop: 12 }}>
            <div className="field">
              <label htmlFor="newPw">New password (min 8 chars)</label>
              <input
                id="newPw"
                className="input"
                type="password"
                placeholder="New password"
                value={pw1}
                onChange={(e) => setPw1(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="confirmPw">Confirm new password</label>
              <input
                id="confirmPw"
                className="input"
                type="password"
                placeholder="Confirm password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={!canSubmit || busy}>
              {busy ? "Saving…" : "Reset password"}
            </button>

            {msg && (
              <div className="alert success" role="status" aria-live="polite">
                {msg}
              </div>
            )}

            <div className="form-links">
              Go back to <Link to="/login">Login</Link>
            </div>
          </div>
        </form>
      </section>
    </main>
  );
}
