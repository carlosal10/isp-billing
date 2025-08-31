// src/pages/Login.jsx
import React, { useState } from "react";
import { Link } from "react-router-dom";            // ← add this
import { useAuth } from "../context/AuthContext";
import "./Login.css";

export default function Login() {
  const { login } = useAuth();
  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setErr("");
        setLoading(true);
        try {
          await login(form);
          window.location.replace("/"); // ok to hard nav after login
        } catch (e) {
          setErr(e?.message || "Login failed");
        } finally {
          setLoading(false);
        }
      }}
      className="space-y-3"
    >
      <input
        value={form.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
        placeholder="Email"
        type="email"
        required
      />
      <input
        value={form.password}
        onChange={(e) => setForm({ ...form, password: e.target.value })}
        placeholder="Password"
        type="password"
        required
      />
      <button type="submit" disabled={loading}>
        {loading ? "Signing in..." : "Login"}
      </button>

      {err && <div className="helper-text" style={{ color: "#ef4444" }}>{err}</div>}

      <div className="helper-text">
        New here? <Link to="/register">Create an account</Link>
      </div>
    </form>
  );
}
