import React, { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/apiClient";

const PRIVACY_ROLES = new Set(["owner", "admin"]);

function errorMessage(err, fallback) {
  return err?.response?.data?.message || err?.message || fallback;
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function safeFilenamePart(value) {
  return String(value || "customer")
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "customer";
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CountGrid({ counts }) {
  if (!counts) return null;
  const entries = [
    ["Invoices", counts.invoices],
    ["Unpaid", counts.unpaidInvoices],
    ["Payments", counts.payments],
    ["Credits", counts.creditNotes],
    ["Messages", counts.messageDeliveries],
    ["Gateway Events", counts.paymentGatewayEvents],
    ["Open Tickets", counts.openSupportTickets],
    ["Active Work Orders", counts.activeWorkOrders],
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 8, marginTop: 12 }}>
      {entries.map(([label, value]) => (
        <div key={label} style={{ background: "#f8fafc", border: "1px solid #eef2f7", borderRadius: 10, padding: 10 }}>
          <div style={{ color: "#64748b", fontSize: 12 }}>{label}</div>
          <div style={{ fontWeight: 800, color: "#0f172a" }}>{Number(value || 0).toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}

export default function CustomerPrivacyCard({ customer, onUpdated }) {
  const { role } = useAuth();
  const [plan, setPlan] = useState(null);
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [anonymizing, setAnonymizing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setPlan(null);
    setConfirmation("");
    setReason("");
    setMessage("");
    setError("");
  }, [customer?._id]);

  if (!customer?._id || !PRIVACY_ROLES.has(role)) return null;

  const isAnonymized =
    customer.status === "anonymized" || customer.privacyProfile?.isAnonymized === true;
  const expectedConfirmation = plan?.confirmationText || "";
  const canAnonymize =
    !isAnonymized &&
    expectedConfirmation &&
    confirmation.trim().toUpperCase() === expectedConfirmation.toUpperCase() &&
    !anonymizing;

  const loadPlan = async () => {
    setLoadingPlan(true);
    setMessage("");
    setError("");
    try {
      const { data } = await api.get(`/customers/${customer._id}/privacy/anonymization-plan`);
      setPlan(data);
    } catch (err) {
      setError(errorMessage(err, "Failed to load anonymization plan"));
    } finally {
      setLoadingPlan(false);
    }
  };

  const exportBundle = async (privacyMode) => {
    if (privacyMode === "full") {
      const ok = window.confirm(
        "Full privacy exports include customer-identifying data. Continue only for a verified disclosure request."
      );
      if (!ok) return;
    }

    setExporting(true);
    setMessage("");
    setError("");
    try {
      const { data } = await api.get(`/customers/${customer._id}/privacy/export`, {
        params: { privacyMode, limit: 500 },
      });
      const account = safeFilenamePart(customer.accountNumber || customer._id);
      downloadJson(data, `${account}-${privacyMode}-privacy-export-${dateStamp()}.json`);
      setMessage(`${privacyMode === "full" ? "Full" : "Masked"} privacy export prepared`);
    } catch (err) {
      setError(errorMessage(err, "Failed to export customer privacy data"));
    } finally {
      setExporting(false);
    }
  };

  const anonymize = async () => {
    if (!canAnonymize) return;
    const ok = window.confirm(
      "This will anonymize direct customer identifiers while retaining commercial records. This action is not intended to be reversed. Continue?"
    );
    if (!ok) return;

    setAnonymizing(true);
    setMessage("");
    setError("");
    try {
      const { data } = await api.post(`/customers/${customer._id}/privacy/anonymize`, {
        confirmation: confirmation.trim(),
        reason: reason.trim() || null,
      });
      setMessage(`Customer anonymized as ${data?.anonymizedAccountNumber || "an anonymized account"}`);
      setPlan((current) => current ? { ...current, alreadyAnonymized: true } : current);
      await onUpdated?.({ customerId: customer._id, reloadCustomer: true });
    } catch (err) {
      setError(errorMessage(err, "Failed to anonymize customer"));
    } finally {
      setAnonymizing(false);
    }
  };

  return (
    <div style={{ border: "1px solid #e6eaf2", borderRadius: 12, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: 4 }}>Customer Privacy Lifecycle</div>
          <div style={{ color: "#64748b", fontSize: 13 }}>
            Export customer data, review anonymization impact, and remove direct identifiers under controlled owner/admin actions.
          </div>
        </div>
        <span
          style={{
            display: "inline-flex",
            borderRadius: 999,
            padding: "6px 12px",
            background: isAnonymized ? "#fee2e2" : "#eafaf1",
            color: isAnonymized ? "#991b1b" : "#166534",
            border: `1px solid ${isAnonymized ? "#fecaca" : "#bbf7d0"}`,
            fontWeight: 800,
            whiteSpace: "nowrap",
          }}
        >
          {isAnonymized ? "Anonymized" : "Identified"}
        </span>
      </div>

      {error ? <div style={{ color: "#b91c1c", marginTop: 10 }}>{error}</div> : null}
      {message ? <div style={{ color: "#166534", marginTop: 10 }}>{message}</div> : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <button className="btn" disabled={exporting} onClick={() => exportBundle("masked")}>
          Export Masked JSON
        </button>
        <button className="btn" disabled={exporting} style={{ background: "#475569" }} onClick={() => exportBundle("full")}>
          Export Full JSON
        </button>
        <button className="btn" disabled={loadingPlan} style={{ background: "#0f766e" }} onClick={loadPlan}>
          {loadingPlan ? "Loading Plan..." : "Review Anonymization Plan"}
        </button>
      </div>

      {plan ? (
        <div style={{ marginTop: 12, borderTop: "1px solid #eef2f7", paddingTop: 12 }}>
          <div style={{ fontWeight: 800, color: "#0f172a" }}>
            Confirmation phrase: <code>{plan.confirmationText}</code>
          </div>
          {Array.isArray(plan.warnings) && plan.warnings.length ? (
            <div style={{ marginTop: 10, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: 10 }}>
              {plan.warnings.map((warning) => (
                <div key={warning}>- {warning}</div>
              ))}
            </div>
          ) : null}
          <CountGrid counts={plan.counts} />

          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder="Type the confirmation phrase to enable anonymization"
              disabled={isAnonymized}
              style={{ padding: "10px 12px", border: "1px solid #e6eaf2", borderRadius: 10 }}
            />
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reason for privacy anonymization"
              disabled={isAnonymized}
              style={{ padding: "10px 12px", border: "1px solid #e6eaf2", borderRadius: 10 }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button
              className="btn"
              disabled={!canAnonymize}
              style={{ background: canAnonymize ? "#b91c1c" : "#94a3b8" }}
              onClick={anonymize}
            >
              {anonymizing ? "Anonymizing..." : "Anonymize Customer"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
