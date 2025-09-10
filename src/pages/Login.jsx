// src/pages/Login.jsx
import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api, API_BASE } from "../lib/apiClient";
import "./Login.css";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [apiHealth, setApiHealth] = useState({ ok: null, msg: "checking…" });

  const from = location.state?.from?.pathname || "/";

  // Health check
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await api.get("/health");
        if (!mounted) return;
        setApiHealth({ ok: !!data?.ok, msg: `API OK (${API_BASE})` });
      } catch (e) {
        setApiHealth({ ok: false, msg: e?.message || "API unreachable" });
        if (e?.__debug) console.error("Health debug:", e.__debug);
      }
    })();
    return () => { mounted = false; };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      await login(form);
      navigate(from, { replace: true });
    } catch (e) {
      setErr(e?.message || "Login failed");
      if (e?.__debug) console.error("Login debug:", e.__debug);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell" aria-label="Login">
      {/* Left: Brand + Pitch */}
      <section className="login-left" aria-labelledby="login-title" style={{
        background:
          "radial-gradient(1200px 380px at 80% -10%, rgba(230,57,70,.20), transparent 60%)," +
          "radial-gradient(900px 320px at 0% 30%, rgba(241,196,15,.18), transparent 60%)," +
          "linear-gradient(180deg, rgba(11,37,69,.93), rgba(11,37,69,.82))," +
          "url('/images/login/hero.jpg')"
      }}>
        <div className="login-left-inner">
          <span className="login-chip">KT-SwiftBridge</span>
          <h1 id="login-title" className="login-title">
            Bill smarter. Grow faster.
          </h1>
          <p className="login-sub">
            Manage plans, automate invoices, and collect payments with confidence.
            Built for ISPs that value speed, clarity, and reliability.
          </p>

          <ul className="login-benefits" role="list">
            <li><span className="dot dot-green" /> One-tap M-Pesa STK Push</li>
            <li><span className="dot dot-amber" /> Automated SMS & email reminders</li>
            <li><span className="dot dot-blue" /> Real-time analytics & collections</li>
          </ul>

          <div className="login-badges" aria-label="Trust and uptime">
            <div className="badge">
              <span className="badge-num">99.9%</span>
              <span className="badge-label">Uptime</span>
            </div>
            <div className="badge">
              <span className="badge-num">AES-256</span>
              <span className="badge-label">Encryption</span>
            </div>
            <div className="badge">
              <span className="badge-num">24/7</span>
              <span className="badge-label">Support</span>
            </div>
          </div>

          <div className="login-footlinks">
            <a href="/status">Status</a>
            <a href="/docs">Docs</a>
            <a href="/contact">Contact</a>
          </div>
        </div>
        {/* Decorative mesh/ambient */}
        <div className="login-ambient" aria-hidden="true" />
      </section>

      {/* Right: Form */}
      <section className="login-right">
        <form onSubmit={handleSubmit} className="login-form" aria-label="Sign in form">
          <div
            className="helper-text"
            style={{ color: apiHealth.ok ? "#16a34a" : apiHealth.ok === null ? "#6b7280" : "#ef4444" }}
            aria-live="polite"
          >
            {apiHealth.msg}
          </div>

          <label className="label" htmlFor="email">Email</label>
          <input
            id="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="you@company.com"
            type="email"
            required
            autoComplete="username"
            className="input"
          />

          <label className="label" htmlFor="password">Password</label>
          <input
            id="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="••••••••"
            type="password"
            required
            autoComplete="current-password"
            className="input"
          />

          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? "Signing in..." : "Login"}
          </button>

          {err && (
            <div className="helper-text err" role="alert" aria-live="assertive">
              {err}
            </div>
          )}

          <div className="form-links">
            <Link to="/forgot-password">Forgot password?</Link>
            <span className="sep">•</span>
            <Link to="/register">Create an account</Link>
          </div>

          <div className="sso-row">
            <span className="sso-line" />
            <span className="sso-label">or</span>
            <span className="sso-line" />
          </div>

          <div className="sso-actions">
            <button type="button" className="btn-ghost" onClick={() => alert("SSO stub")}>
              Continue with Google
            </button>
            <button type="button" className="btn-ghost" onClick={() => alert("SSO stub")}>
              Continue with Microsoft
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
