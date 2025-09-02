// src/pages/Register.jsx
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
        console.error("Health check failed:", e);
        setApiHealth({
          ok: false,
          msg: e?.message || "API unreachable",
        });
      }
    })();
    return () => { mounted = false; };
  }, []);

  const pwScore = useMemo(() => scorePassword(form.password), [form.password]);
  const canSubmit =
    form.tenantName.trim().length > 0 &&
    form.displayName.trim().length > 0 &&
    /\S+@\S+\.\S+/.test(form.email) &&
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
      console.error("Register error:", e2, e2?.__debug);
      setErr(e2?.message || "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Create account">
      <div className="helper-text" style={{ color: apiHealth.ok ? "#16a34a" : "#ef4444" }}>
        {apiHealth.msg}
      </div>

      <h2 style={{ margin: 0 }}>Create your account</h2>

      <input
        placeholder="Tenant / ISP name"
        value={form.tenantName}
        onChange={onChange("tenantName")}
        required
        autoComplete="organization"
      />

      <input
        placeholder="Your full name"
        value={form.displayName}
        onChange={onChange("displayName")}
        required
        autoComplete="name"
      />

      <input
        type="email"
        placeholder="Email"
        value={form.email}
        onChange={onChange("email")}
        required
        autoComplete="email"
      />

      <div style={{ display: "grid", gap: "0.5rem" }}>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            type={showPw ? "text" : "password"}
            placeholder="Password (min 8 chars)"
            value={form.password}
            onChange={onChange("password")}
            required
            autoComplete="new-password"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="ghost"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? "Hide password" : "Show password"}
          >
            {showPw ? "Hide" : "Show"}
          </button>
        </div>

        <div aria-label="password strength" className="helper-text">
          Strength:
          <span style={{ marginLeft: 8 }}>
            {"■".repeat(pwScore)}
            {"□".repeat(5 - pwScore)}
          </span>
          <span style={{ marginLeft: 8 }}>
            {pwScore <= 2 ? "weak" : pwScore <= 3 ? "good" : "strong"}
          </span>
        </div>

        <input
          type={showPw ? "text" : "password"}
          placeholder="Confirm password"
          value={form.confirm}
          onChange={onChange("confirm")}
          required
          autoComplete="new-password"
        />
      </div>

      {!/\S+@\S+\.\S+/.test(form.email) && form.email.length > 0 && (
        <div className="helper-text" style={{ color: "#ef4444" }}>
          Enter a valid email address.
        </div>
      )}
      {form.password !== form.confirm && form.confirm.length > 0 && (
        <div className="helper-text" style={{ color: "#ef4444" }}>
          Passwords do not match.
        </div>
      )}

      <button type="submit" disabled={!canSubmit}>
        {busy ? "Creating…" : "Create account"}
      </button>

      {err && (
        <div className="helper-text" style={{ color: "#ef4444", whiteSpace: "pre-wrap" }}>
          {err}
        </div>
      )}

      <div className="helper-text">
        Already have an account? <Link to="/login">Sign in</Link>
      </div>
    </form>
  );
}
