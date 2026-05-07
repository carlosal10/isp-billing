import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/apiClient";
import { useAuth } from "../context/AuthContext";

const ROLE_OPTIONS = ["owner", "admin", "operator"];

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "-";
}

function roleLabel(value) {
  return String(value || "operator").charAt(0).toUpperCase() + String(value || "operator").slice(1);
}

function roleTone(role) {
  if (role === "owner") return { background: "#fee2e2", color: "#991b1b" };
  if (role === "admin") return { background: "#dbeafe", color: "#1d4ed8" };
  return { background: "#dcfce7", color: "#166534" };
}

function inviteLink(code) {
  if (!code || typeof window === "undefined") return code || "";
  return `${window.location.origin}/invite/accept?code=${encodeURIComponent(code)}`;
}

function SectionCard({ title, subtitle, actions, children }) {
  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 18,
        padding: 20,
        boxShadow: "0 12px 30px rgba(15, 23, 42, 0.06)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>{title}</h2>
          {subtitle ? <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 14 }}>{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function RoleBadge({ role }) {
  const tone = roleTone(role);
  return (
    <span style={{ borderRadius: 999, padding: "5px 10px", fontWeight: 800, background: tone.background, color: tone.color }}>
      {roleLabel(role)}
    </span>
  );
}

export default function TeamAccess() {
  const { role, status, user } = useAuth();
  const canView = role === "owner" || role === "admin";
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [inviteForm, setInviteForm] = useState({ email: "", role: "operator", expiresInHours: 72 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const availableInviteRoles = useMemo(
    () => (role === "owner" ? ROLE_OPTIONS : ["operator"]),
    [role]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [membersRes, invitesRes] = await Promise.all([
        api.get("/team/members"),
        api.get("/invites"),
      ]);
      setMembers(Array.isArray(membersRes.data) ? membersRes.data : []);
      setInvites(Array.isArray(invitesRes.data) ? invitesRes.data : []);
    } catch (err) {
      setError(err?.message || "Failed to load team access");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status !== "auth" || !canView) return;
    load();
  }, [canView, load, status]);

  const createInvite = async (event) => {
    event.preventDefault();
    setBusy("invite");
    setMessage("");
    setError("");
    try {
      await api.post("/invites", {
        ...inviteForm,
        expiresInHours: Number(inviteForm.expiresInHours) || 72,
      });
      setInviteForm({ email: "", role: "operator", expiresInHours: 72 });
      setMessage("Invite created. Share the generated invite link with the team member.");
      await load();
    } catch (err) {
      setError(err?.message || "Failed to create invite");
    } finally {
      setBusy("");
    }
  };

  const updateRole = async (member, nextRole) => {
    setBusy(`role:${member._id}`);
    setMessage("");
    setError("");
    try {
      await api.patch(`/team/members/${member._id}/role`, { role: nextRole });
      setMessage("Team member role updated.");
      await load();
    } catch (err) {
      setError(err?.message || "Failed to update role");
    } finally {
      setBusy("");
    }
  };

  const removeMember = async (member) => {
    const label = member.user?.email || member.user?.displayName || "this member";
    if (!window.confirm(`Remove ${label} from this tenant?`)) return;
    setBusy(`remove:${member._id}`);
    setMessage("");
    setError("");
    try {
      await api.delete(`/team/members/${member._id}`);
      setMessage("Team member removed.");
      await load();
    } catch (err) {
      setError(err?.message || "Failed to remove member");
    } finally {
      setBusy("");
    }
  };

  const revokeInvite = async (invite) => {
    setBusy(`invite:${invite._id}`);
    setMessage("");
    setError("");
    try {
      await api.delete(`/invites/${invite._id}`);
      setMessage("Invite revoked.");
      await load();
    } catch (err) {
      setError(err?.message || "Failed to revoke invite");
    } finally {
      setBusy("");
    }
  };

  const copyInvite = async (invite) => {
    const link = inviteLink(invite.code);
    try {
      await navigator.clipboard.writeText(link);
      setMessage("Invite link copied.");
    } catch {
      setMessage(link);
    }
  };

  if (status === "unknown") return <div style={{ padding: 16 }}>Checking session...</div>;
  if (status !== "auth") return <div style={{ padding: 16 }}>Please log in to manage team access.</div>;
  if (!canView) return <div style={{ padding: 16 }}>Team access is limited to tenant owners and admins.</div>;

  return (
    <div
      style={{
        padding: 20,
        display: "grid",
        gap: 20,
        background: "linear-gradient(180deg, #f8fafc 0%, #eef2ff 52%, #f0fdfa 100%)",
        minHeight: "100%",
      }}
    >
      <header>
        <div style={{ color: "#1d4ed8", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>Access Control</div>
        <h1 style={{ margin: "6px 0 4px", color: "#0f172a", fontSize: 34 }}>Team Access</h1>
        <p style={{ margin: 0, color: "#475569", maxWidth: 820 }}>
          Manage tenant members, issue invites, and keep owner/admin/operator boundaries explicit.
        </p>
      </header>

      {message ? <div style={{ color: "#166534", fontWeight: 800 }}>{message}</div> : null}
      {error ? <div style={{ color: "#b91c1c", fontWeight: 800 }}>{error}</div> : null}

      <SectionCard
        title="Invite Team Member"
        subtitle={role === "owner" ? "Owners can invite owners, admins, and operators." : "Admins can invite operators."}
        actions={<button className="btn" onClick={load} disabled={loading}>Refresh</button>}
      >
        <form onSubmit={createInvite} style={{ display: "grid", gridTemplateColumns: "minmax(220px,1fr) 160px 160px auto", gap: 10 }}>
          <input
            type="email"
            value={inviteForm.email}
            onChange={(event) => setInviteForm((current) => ({ ...current, email: event.target.value }))}
            placeholder="teammate@example.com"
            required
            style={{ padding: "11px 12px", border: "1px solid #cbd5e1", borderRadius: 12 }}
          />
          <select
            value={inviteForm.role}
            onChange={(event) => setInviteForm((current) => ({ ...current, role: event.target.value }))}
            style={{ padding: "11px 12px", border: "1px solid #cbd5e1", borderRadius: 12 }}
          >
            {availableInviteRoles.map((item) => (
              <option key={item} value={item}>{roleLabel(item)}</option>
            ))}
          </select>
          <select
            value={inviteForm.expiresInHours}
            onChange={(event) => setInviteForm((current) => ({ ...current, expiresInHours: Number(event.target.value) }))}
            style={{ padding: "11px 12px", border: "1px solid #cbd5e1", borderRadius: 12 }}
          >
            <option value={24}>24 hours</option>
            <option value={72}>72 hours</option>
            <option value={168}>7 days</option>
          </select>
          <button className="btn" type="submit" disabled={busy === "invite"}>{busy === "invite" ? "Creating..." : "Create Invite"}</button>
        </form>
      </SectionCard>

      <SectionCard title="Members" subtitle={`${members.length} active tenant member(s)`}>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const isSelf = member.user?._id && user?.id && String(member.user._id) === String(user.id);
                const canChange = role === "owner" || (role === "admin" && member.role === "operator");
                return (
                  <tr key={member._id}>
                    <td>{member.user?.displayName || "-"}</td>
                    <td>{member.user?.email || "-"}</td>
                    <td>
                      {canChange ? (
                        <select
                          value={member.role}
                          onChange={(event) => updateRole(member, event.target.value)}
                          disabled={busy === `role:${member._id}`}
                        >
                          {(role === "owner" ? ROLE_OPTIONS : ["operator"]).map((item) => (
                            <option key={item} value={item}>{roleLabel(item)}</option>
                          ))}
                        </select>
                      ) : (
                        <RoleBadge role={member.role} />
                      )}
                    </td>
                    <td>{member.user?.isActive === false ? "Disabled" : "Active"}</td>
                    <td>{formatDateTime(member.createdAt)}</td>
                    <td>
                      <button
                        className="btn"
                        style={{ background: "#ef4444" }}
                        disabled={isSelf || busy === `remove:${member._id}` || !canChange}
                        onClick={() => removeMember(member)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!members.length ? (
                <tr><td colSpan={6} style={{ textAlign: "center" }}>{loading ? "Loading..." : "No members found"}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Pending Invites" subtitle={`${invites.length} unaccepted invite(s)`}>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Expires</th>
                <th>Invite Link</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite._id}>
                  <td>{invite.email}</td>
                  <td><RoleBadge role={invite.role} /></td>
                  <td>{formatDateTime(invite.expiresAt)}</td>
                  <td style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {inviteLink(invite.code)}
                  </td>
                  <td style={{ display: "flex", gap: 8 }}>
                    <button className="btn" onClick={() => copyInvite(invite)}>Copy</button>
                    <button
                      className="btn"
                      style={{ background: "#ef4444" }}
                      disabled={busy === `invite:${invite._id}`}
                      onClick={() => revokeInvite(invite)}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
              {!invites.length ? (
                <tr><td colSpan={5} style={{ textAlign: "center" }}>{loading ? "Loading..." : "No pending invites"}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
