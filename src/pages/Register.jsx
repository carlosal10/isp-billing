import React, { useMemo, useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api, API_BASE } from "../lib/apiClient";
import "./Login.css";

function scorePassword(pw) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(s, 5);
}

export default function Register() {
  const navigate = useNavigate();
  const { register } = useAuth();

  const [form, setForm] = useState({
    tenantName: "",
    displayName: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [apiHealth, setApiHealth] = useState({ ok: null, msg: "checking…" });

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await api.get("/health");
        if (!mounted) return;
        setApiHealth({ ok: !!data?.ok, msg: `API OK (${API_BASE})` });
      } catch (e) {
        setApiHealth({ ok: false, msg: e?.message || "API unreachable" });
      }
    })();
    return () => { mounted = false; };
  }, []);

  const pwScore = useMemo(() => scorePassword(form.password), [form.password]);
  const emailValid = /\S+@\S+\.\S+/.test(form.email);

  const canSubmit =
    form.tenantName.trim().length > 0 &&
    form.displayName.trim().length > 0 &&
    emailValid &&
    form.password.length >= 8 &&
    form.password === form.confirm &&
    !busy;

  const onChange = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (!canSubmit) return;

    setBusy(true);
    try {
      await register({
        tenantName: form.tenantName.trim(),
        displayName: form.displayName.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      navigate("/", { replace: true });
    } catch (e2) {
      setErr(e2?.message || "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell" aria-label="Register">
      {/* Left: Brand + Pitch (same as Login for visual consistency) */}
      <section
        className="login-left"
        aria-labelledby="register-title"
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
          <h1 id="register-title" className="login-title">Bill smarter. Grow faster.</h1>
          <p className="login-sub">
            Create your account to manage plans, automate invoices, and collect payments with confidence.
          </p>
          <ul className="login-benefits">
            <li><span className="dot dot-green" /> One-tap M-Pesa STK Push</li>
            <li><span className="dot dot-amber" /> Automated SMS & email reminders</li>
            <li><span className="dot dot-blue" /> Real-time analytics & collections</li>
          </ul>
          <div className="login-badges" aria-label="Trust and uptime">
            <div className="badge"><span className="badge-num">99.9%</span><span className="badge-label">Uptime</span></div>
            <div className="badge"><span className="badge-num">AES-256</span><span className="badge-label">Encryption</span></div>
            <div className="badge"><span className="badge-num">24/7</span><span className="badge-label">Support</span></div>
          </div>
          <div className="login-footlinks">
            <a href="/status">Status</a>
            <a href="/docs">Docs</a>
            <a href="/contact">Contact</a>
          </div>
        </div>
        <div className="login-ambient" aria-hidden="true" />
      </section>

      {/* Right: Register form */}
      <section className="login-right">
        <form onSubmit={submit} className="login-form register-form" aria-label="Create account">
          <div
            className="helper-text"
            style={{ color: apiHealth.ok ? "#16a34a" : apiHealth.ok === null ? "#6b7280" : "#ef4444" }}
            aria-live="polite"
          >
            {apiHealth.msg}
          </div>

          <h2 style={{ margin: 0, color: "#0B2545" }}>Create your account</h2>

          {/* Row 1 */}
          <div className="form-grid" style={{ marginTop: 12 }}>
            <div className="field">
              <label htmlFor="tenantName">Tenant / ISP name</label>
              <input
                id="tenantName"
                className="input"
                placeholder="Your ISP / tenant"
                value={form.tenantName}
                onChange={onChange("tenantName")}
                required
                autoComplete="organization"
              />
            </div>

            <div className="field">
              <label htmlFor="displayName">Your full name</label>
              <input
                id="displayName"
                className="input"
                placeholder="e.g., Jane Doe"
                value={form.displayName}
                onChange={onChange("displayName")}
                required
                autoComplete="name"
              />
            </div>
          </div>

          {/* Row 2 */}
          <div className="form-grid">
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                className="input"
                type="email"
                placeholder="you@company.com"
                value={form.email}
                onChange={onChange("email")}
                required
                autoComplete="email"
              />
            </div>

            <div className="field">
              <label htmlFor="password">Password (min 8 chars)</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  id="password"
                  className="input"
                  type={showPw ? "text" : "password"}
                  placeholder="Create a password"
                  value={form.password}
                  onChange={onChange("password")}
                  required
                  autoComplete="new-password"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  className="btn-ghost"
                  style={{ width: "auto", padding: "10px 12px" }}
                >
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
              <div className="password-meta" aria-label="password strength">
                Strength:
                <span style={{ marginLeft: 8 }}>
                  {"■".repeat(pwScore)}
                  {"□".repeat(5 - pwScore)}
                </span>
                <span style={{ marginLeft: 8 }}>
                  {pwScore <= 2 ? "weak" : pwScore <= 3 ? "good" : "strong"}
                </span>
              </div>
            </div>
          </div>

          {/* Row 3 */}
          <div className="form-grid">
            <div className="field">
              <label htmlFor="confirm">Confirm password</label>
              <input
                id="confirm"
                className="input"
                type={showPw ? "text" : "password"}
                placeholder="Re-enter password"
                value={form.confirm}
                onChange={onChange("confirm")}
                required
                autoComplete="new-password"
              />
            </div>
            <div className="field">{/* spacer to keep grid balanced */}</div>
          </div>

          {/* Inline validation */}
          {!emailValid && form.email.length > 0 && (
            <div className="alert error">Enter a valid email address.</div>
          )}
          {form.password !== form.confirm && form.confirm.length > 0 && (
            <div className="alert error">Passwords do not match.</div>
          )}

          <div className="form-actions">
            <button type="submit" disabled={!canSubmit} className="btn-primary">
              {busy ? "Creating…" : "Create account"}
            </button>

            {err && (
              <div className="helper-text err" role="alert" aria-live="assertive">
                {err}
              </div>
            )}

            <div className="form-links">
              Already have an account? <Link to="/login">Sign in</Link>
            </div>
          </div>
        </form>
      </section>
    </main>
  );
}
