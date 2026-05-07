import React, { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "./Login.css";

export default function InviteAccept() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { acceptInvite } = useAuth();
  const inviteCode = useMemo(() => params.get("code") || "", [params]);
  const [code, setCode] = useState(inviteCode);
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setMessage("");
    if (password.length < 8 || password !== confirmPassword) {
      setMessage("Passwords must match and be at least 8 characters.");
      return;
    }

    setBusy(true);
    try {
      await acceptInvite({ code, displayName, password });
      navigate("/", { replace: true });
    } catch (err) {
      setMessage(err?.message || "Failed to accept invite");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card" style={{ maxWidth: 520 }}>
        <div className="login-brand">
          <h1>Join Your ISP Workspace</h1>
          <p>Accept your tenant invite and create your operator account.</p>
        </div>

        <form onSubmit={submit} className="login-form">
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.trim())}
            placeholder="Invite code"
            required
          />
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Display name"
            required
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password (min 8 chars)"
            required
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Confirm password"
            required
          />
          <button type="submit" disabled={busy || !code}>
            {busy ? "Joining..." : "Accept Invite"}
          </button>
        </form>

        {message ? <div className="helper-text" style={{ color: "#ef4444" }}>{message}</div> : null}
        <div className="helper-text" style={{ marginTop: 14 }}>
          Already have an account? <Link to="/login">Return to login</Link>
        </div>
      </div>
    </div>
  );
}
