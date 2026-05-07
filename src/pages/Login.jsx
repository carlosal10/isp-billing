import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api, API_BASE } from "../lib/apiClient";
import "./Login.css";

function loginModeCopy(mode) {
  if (mode === "platform") {
    return {
      chip: "Platform Console",
      title: "Take control of the payment edge.",
      subtitle:
        "Investigate orphaned gateway events, adopt them safely into the right tenant, and keep settlement operations visible across the whole platform.",
      benefits: [
        "Cross-tenant orphan queue visibility",
        "Guided adopt, retry, and manual resolution",
        "Platform-wide payment incident response",
      ],
      submit: "Sign In To Platform",
    };
  }

  if (mode === "customer") {
    return {
      chip: "Customer Portal",
      title: "Stay on top of your service.",
      subtitle:
        "Check your balance, review invoices, see support ticket progress, and stay informed about outages or maintenance that affect your connection.",
      benefits: [
        "Invoice and payment visibility in one place",
        "Self-service support request tracking",
        "Live outage and maintenance updates",
      ],
      submit: "Open Customer Portal",
    };
  }

  return {
    chip: "KT-SwiftBridge",
    title: "Bill smarter. Grow faster.",
    subtitle:
      "Manage plans, automate invoices, and collect payments with confidence. Built for ISPs that value speed, clarity, and reliability.",
    benefits: [
      "One-tap M-Pesa STK Push",
      "Automated SMS and email reminders",
      "Real-time analytics and collections",
    ],
    submit: "Login",
  };
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, loginCustomer, loginPlatform } = useAuth();

  const queryMode = new URLSearchParams(location.search).get("mode");
  const initialMode =
    queryMode === "platform" ? "platform" : queryMode === "customer" ? "customer" : "tenant";

  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({
    email: "",
    password: "",
    tenantName: "",
    accountNumber: "",
    credential: "",
    pin: "",
  });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [apiHealth, setApiHealth] = useState({ ok: null, msg: "checking..." });

  const from = location.state?.from?.pathname || "/";
  const copy = useMemo(() => loginModeCopy(mode), [mode]);

  useEffect(() => {
    const nextQueryMode = new URLSearchParams(location.search).get("mode");
    setMode(
      nextQueryMode === "platform"
        ? "platform"
        : nextQueryMode === "customer"
          ? "customer"
          : "tenant"
    );
  }, [location.search]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await api.get("/health");
        if (!mounted) return;
        setApiHealth({ ok: !!data?.ok, msg: `API OK (${API_BASE})` });
      } catch (e) {
        if (!mounted) return;
        setApiHealth({ ok: false, msg: e?.message || "API unreachable" });
        if (e?.__debug) console.error("Health debug:", e.__debug);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setErr("");
    setLoading(true);
    try {
      if (mode === "platform") {
        await loginPlatform(form);
        navigate("/platform/gateway-events", { replace: true });
      } else if (mode === "customer") {
        await loginCustomer(form);
        navigate("/portal", { replace: true });
      } else {
        await login(form);
        navigate(from, { replace: true });
      }
    } catch (e) {
      setErr(e?.message || "Login failed");
      if (e?.__debug) console.error("Login debug:", e.__debug);
    } finally {
      setLoading(false);
    }
  }

  const switchMode = (nextMode) => {
    if (nextMode === mode) return;
    setErr("");
    setMode(nextMode);
    navigate(
      nextMode === "platform"
        ? "/login?mode=platform"
        : nextMode === "customer"
          ? "/login?mode=customer"
          : "/login",
      { replace: true }
    );
  };

  return (
    <main className="login-shell" aria-label="Login">
      <section
        className="login-left"
        aria-labelledby="login-title"
        style={{
          background:
            "radial-gradient(1200px 380px at 80% -10%, rgba(230,57,70,.20), transparent 60%)," +
            "radial-gradient(900px 320px at 0% 30%, rgba(241,196,15,.18), transparent 60%)," +
            "linear-gradient(180deg, rgba(11,37,69,.93), rgba(11,37,69,.82))," +
            "url('/images/hero.jpg')",
        }}
      >
        <div className="login-left-inner">
          <span className="login-chip">{copy.chip}</span>
          <h1 id="login-title" className="login-title">
            {copy.title}
          </h1>
          <p className="login-sub">{copy.subtitle}</p>

          <ul className="login-benefits">
            <li>
              <span className="dot dot-green" /> {copy.benefits[0]}
            </li>
            <li>
              <span className="dot dot-amber" /> {copy.benefits[1]}
            </li>
            <li>
              <span className="dot dot-blue" /> {copy.benefits[2]}
            </li>
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
        <div className="login-ambient" aria-hidden="true" />
      </section>

      <section className="login-right">
        <form onSubmit={handleSubmit} className="login-form" aria-label="Sign in form">
          <div className="login-mode-switch" role="tablist" aria-label="Login type">
            <button
              type="button"
              className={mode === "tenant" ? "active" : ""}
              onClick={() => switchMode("tenant")}
            >
              Tenant Workspace
            </button>
            <button
              type="button"
              className={mode === "platform" ? "active" : ""}
              onClick={() => switchMode("platform")}
            >
              Platform Admin
            </button>
            <button
              type="button"
              className={mode === "customer" ? "active" : ""}
              onClick={() => switchMode("customer")}
            >
              Customer Portal
            </button>
          </div>

          <div
            className="helper-text"
            style={{
              color: apiHealth.ok ? "#16a34a" : apiHealth.ok === null ? "#6b7280" : "#ef4444",
            }}
            aria-live="polite"
          >
            {apiHealth.msg}
          </div>

          <div className="login-mode-caption">
            {mode === "platform"
              ? "Use your platform-admin account to work the orphan payment queue."
              : mode === "customer"
                ? "Use your ISP workspace, account number, and registered contact or portal PIN."
                : "Use your tenant account to access billing, networking, and collections."}
          </div>

          {mode === "customer" ? (
            <>
              <label className="label" htmlFor="tenantName">
                ISP Workspace
              </label>
              <input
                id="tenantName"
                value={form.tenantName}
                onChange={(e) => setForm({ ...form, tenantName: e.target.value })}
                placeholder="Acme Fiber"
                required
                className="input"
              />

              <label className="label" htmlFor="accountNumber">
                Account Number
              </label>
              <input
                id="accountNumber"
                value={form.accountNumber}
                onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
                placeholder="ACC-1001"
                required
                className="input"
              />

              <label className="label" htmlFor="credential">
                Registered Phone Or Email
              </label>
              <input
                id="credential"
                value={form.credential}
                onChange={(e) => setForm({ ...form, credential: e.target.value })}
                placeholder="0712345678 or you@example.com"
                className="input"
              />

              <label className="label" htmlFor="pin">
                Portal PIN (Optional)
              </label>
              <input
                id="pin"
                value={form.pin}
                onChange={(e) => setForm({ ...form, pin: e.target.value })}
                placeholder="Use this if your ISP issued one"
                type="password"
                autoComplete="current-password"
                className="input"
              />
            </>
          ) : (
            <>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder={mode === "platform" ? "ops@company.com" : "you@company.com"}
                type="email"
                required
                autoComplete="username"
                className="input"
              />

              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
                type="password"
                required
                autoComplete="current-password"
                className="input"
              />
            </>
          )}

          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? "Signing in..." : copy.submit}
          </button>

          {err ? (
            <div className="helper-text err" role="alert" aria-live="assertive">
              {err}
            </div>
          ) : null}

          {mode === "tenant" ? (
            <>
              <div className="form-links">
                <Link to="/forgot-password">Forgot password?</Link>
                <span className="sep">â€¢</span>
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
            </>
          ) : mode === "platform" ? (
            <div className="platform-login-note">
              Platform sessions are isolated from tenant workspaces so operational actions stay deliberate and auditable.
            </div>
          ) : (
            <div className="platform-login-note">
              Customer portal sessions are limited to your own account so invoices, payments, tickets, and outages stay private.
            </div>
          )}
        </form>
      </section>
    </main>
  );
}
