import { useState, useMemo } from "react";
import { api } from "../lib/apiClient";
import { useAuth } from "../context/AuthContext";
import "./Login.css"; // reuse the same styles (form.space-y-3, inputs, helper-text, etc.)

function scorePassword(pw) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(s, 5); // 0..5
}

export default function Register() {
  const { login } = useAuth();
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

  const pwScore = useMemo(() => scorePassword(form.password), [form.password]);
  const canSubmit =
    form.tenantName.trim().length > 0 &&
    form.displayName.trim().length > 0 &&
    /\S+@\S+\.\S+/.test(form.email) &&
    form.password.length >= 8 &&
    form.password === form.confirm &&
    !busy;

  const onChange = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!canSubmit) return;
    try {
      setBusy(true);
      // Create tenant + user
      const { data } = await api.post("/auth/register", {
        tenantName: form.tenantName.trim(),
        displayName: form.displayName.trim(),
        email: form.email.trim(),
        password: form.password,
      });

      if (!data?.ok) throw new Error(data?.error || "Registration failed");

      // Hydrate auth using normal login flow (ensures refresh timers/interceptors are set)
      await login({ email: form.email.trim(), password: form.password });

      // Navigate in the simplest, SSR-safe way
      window.location.replace("/");
    } catch (e2) {
      setErr(e2?.message || "Registration failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Create account">
      <h2 style={{ margin: 0 }}>Create your account</h2>

      <input
        placeholder="Tenant / ISP name"
        value={form.tenantName}
        onChange={onChange("tenantName")}
        required
      />

      <input
        placeholder="Your full name"
        value={form.displayName}
        onChange={onChange("displayName")}
        required
      />

      <input
        type="email"
        placeholder="Email"
        value={form.email}
        onChange={onChange("email")}
        required
      />

      <div style={{ display: "grid", gap: "0.5rem" }}>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            type={showPw ? "text" : "password"}
            placeholder="Password (min 8 chars)"
            value={form.password}
            onChange={onChange("password")}
            required
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

        {/* Strength meter (simple, no external libs) */}
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
        <div className="helper-text" style={{ color: "#ef4444" }}>
          {err}
        </div>
      )}

      <div className="helper-text">
        Already have an account? <a href="/login">Sign in</a>
      </div>
    </form>
  );
}
