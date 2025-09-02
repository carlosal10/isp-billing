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

  // quick API health check so misconfig shows up immediately
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await api.get("/health");
        if (!mounted) return;
        setApiHealth({ ok: !!data?.ok, msg: `API OK (${API_BASE})` });
      } catch (e) {
        setApiHealth({ ok: false, msg: e?.message || "API unreachable" });
        // also log the shaped debug if present
        if (e?.__debug) console.error("Health debug:", e.__debug);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      await login(form);
      // route back to where they came from (or home)
      navigate(from, { replace: true });
    } catch (e) {
      // message is annotated by apiClient interceptor; show verbatim
      setErr(e?.message || "Login failed");
      if (e?.__debug) console.error("Login debug:", e.__debug);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="login-form space-y-3" aria-label="Sign in">
      <div className="helper-text" style={{ color: apiHealth.ok ? "#16a34a" : "#ef4444" }}>
        {apiHealth.msg}
      </div>

      <input
        value={form.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
        placeholder="Email"
        type="email"
        required
        autoComplete="username"
      />

      <input
        value={form.password}
        onChange={(e) => setForm({ ...form, password: e.target.value })}
        placeholder="Password"
        type="password"
        required
        autoComplete="current-password"
      />

      <button type="submit" disabled={loading}>
        {loading ? "Signing in..." : "Login"}
      </button>

      {err && (
        <div className="helper-text" style={{ color: "#ef4444", whiteSpace: "pre-wrap" }}>
          {err}
        </div>
      )}

      <div className="helper-text">
        New here? <Link to="/register">Create an account</Link>
      </div>
    </form>
  );
}
