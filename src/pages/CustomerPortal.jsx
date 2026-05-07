import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { portalApi } from "../lib/apiClient";

const EMPTY_TICKET_FORM = {
  title: "",
  category: "",
  priority: "medium",
  assetId: "",
  description: "",
  note: "",
};

const EMPTY_PAYMENT_FORM = {
  invoiceId: "",
  phone: "",
};

const EMPTY_PIN_FORM = {
  currentPin: "",
  newPin: "",
};

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "-";
}

function formatMoney(value, currency = "KES") {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatToken(value) {
  return String(value || "")
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function badge(value) {
  const normalized = String(value || "").toLowerCase();
  if (["paid", "resolved", "closed", "success", "active"].includes(normalized)) {
    return { background: "#dcfce7", color: "#166534" };
  }
  if (["overdue", "critical", "chargeback", "failed"].includes(normalized)) {
    return { background: "#fee2e2", color: "#991b1b" };
  }
  if (["issued", "pending", "open", "investigating", "high"].includes(normalized)) {
    return { background: "#dbeafe", color: "#1d4ed8" };
  }
  if (["scheduled", "monitoring", "partially_paid", "medium"].includes(normalized)) {
    return { background: "#fef3c7", color: "#92400e" };
  }
  return { background: "#e2e8f0", color: "#475569" };
}

function SummaryCard({ title, value, accent, hint }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 18,
        padding: 18,
        boxShadow: "0 12px 30px rgba(15, 23, 42, 0.05)",
      }}
    >
      <div style={{ color: "#64748b", fontSize: 13, fontWeight: 700 }}>{title}</div>
      <div style={{ marginTop: 8, fontSize: 30, fontWeight: 800, color: accent || "#0f172a" }}>{value}</div>
      {hint ? <div style={{ marginTop: 8, color: "#475569", fontSize: 13 }}>{hint}</div> : null}
    </div>
  );
}

function SectionCard({ title, subtitle, actions, children }) {
  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 20,
        padding: 22,
        boxShadow: "0 16px 34px rgba(15, 23, 42, 0.07)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 14,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>{title}</h2>
          {subtitle ? (
            <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 14 }}>{subtitle}</p>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

async function fetchPortalSnapshot() {
  const [overviewRes, invoicesRes, paymentsRes, ticketsRes, incidentsRes] = await Promise.all([
    portalApi.get("/overview"),
    portalApi.get("/invoices", { params: { limit: 12 } }),
    portalApi.get("/payments", { params: { limit: 12 } }),
    portalApi.get("/tickets", { params: { limit: 12 } }),
    portalApi.get("/incidents", { params: { limit: 12 } }),
  ]);

  return {
    overview: overviewRes.data || {},
    invoices: Array.isArray(invoicesRes.data) ? invoicesRes.data : [],
    payments: Array.isArray(paymentsRes.data) ? paymentsRes.data : [],
    tickets: Array.isArray(ticketsRes.data) ? ticketsRes.data : [],
    incidents: Array.isArray(incidentsRes.data) ? incidentsRes.data : [],
  };
}

export default function CustomerPortal() {
  const navigate = useNavigate();
  const { logout, status, user } = useAuth();

  const [overview, setOverview] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [paymentForm, setPaymentForm] = useState(EMPTY_PAYMENT_FORM);
  const [pendingPayment, setPendingPayment] = useState(null);
  const [pinForm, setPinForm] = useState(EMPTY_PIN_FORM);
  const [ticketForm, setTicketForm] = useState(EMPTY_TICKET_FORM);

  const assets = useMemo(() => overview?.network?.assets || [], [overview]);
  const payableInvoices = useMemo(
    () => invoices.filter((invoice) => Number(invoice.balanceDue || 0) > 0),
    [invoices]
  );

  const loadSnapshot = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const snapshot = await fetchPortalSnapshot();
      setOverview(snapshot.overview);
      setInvoices(snapshot.invoices);
      setPayments(snapshot.payments);
      setTickets(snapshot.tickets);
      setIncidents(snapshot.incidents);
      setError("");
      setPaymentForm((current) => ({
        ...current,
        phone: current.phone || snapshot.overview?.customer?.phone || "",
        invoiceId:
          current.invoiceId ||
          snapshot.invoices.find((invoice) => Number(invoice.balanceDue || 0) > 0)?._id ||
          "",
      }));
    } catch (err) {
      console.error("Failed to load customer portal:", err);
      setError(err?.message || "Failed to load customer portal");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (status !== "auth") return;
    loadSnapshot(true);
  }, [status]);

  const handleLogout = async () => {
    await logout();
    navigate("/login?mode=customer", { replace: true });
  };

  const submitTicket = async (event) => {
    event.preventDefault();
    setBusyAction("ticket:create");
    setMessage("");
    setError("");
    try {
      await portalApi.post("/tickets", {
        title: ticketForm.title,
        category: ticketForm.category || undefined,
        priority: ticketForm.priority,
        assetId: ticketForm.assetId || undefined,
        description: ticketForm.description || undefined,
        note: ticketForm.note || undefined,
      });
      setTicketForm(EMPTY_TICKET_FORM);
      setMessage("Support request submitted.");
      await loadSnapshot(false);
    } catch (err) {
      setError(err?.message || "Failed to submit support request");
    } finally {
      setBusyAction("");
    }
  };

  const startInvoicePayment = (invoice) => {
    setPaymentForm((current) => ({
      ...current,
      invoiceId: invoice?._id || current.invoiceId,
      phone: current.phone || overview?.customer?.phone || "",
    }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submitMpesaPayment = async (event) => {
    event.preventDefault();
    if (!paymentForm.invoiceId) {
      setError("Choose an invoice before starting payment.");
      return;
    }
    setBusyAction("payment:stk");
    setMessage("");
    setError("");
    try {
      const { data } = await portalApi.post("/payments/mpesa/stk", {
        invoiceId: paymentForm.invoiceId,
        phone: paymentForm.phone || undefined,
      });
      setPendingPayment({
        paymentId: data.paymentId,
        invoiceId: data.invoiceId,
        amount: data.amount,
        status: "Pending",
      });
      setMessage(data.customerMessage || "STK push sent. Complete the prompt on your phone.");
      await loadSnapshot(false);
    } catch (err) {
      setError(err?.message || "Failed to start M-Pesa payment");
    } finally {
      setBusyAction("");
    }
  };

  const checkPendingPayment = async () => {
    if (!pendingPayment?.paymentId) return;
    setBusyAction("payment:status");
    setError("");
    try {
      const { data } = await portalApi.get(`/payments/${pendingPayment.paymentId}/status`);
      setPendingPayment((current) => ({
        ...(current || {}),
        status: data.status,
        transactionId: data.transactionId || null,
      }));
      setMessage(`Payment status: ${formatToken(data.status)}`);
      await loadSnapshot(false);
    } catch (err) {
      setError(err?.message || "Failed to check payment status");
    } finally {
      setBusyAction("");
    }
  };

  const submitPin = async (event) => {
    event.preventDefault();
    setBusyAction("security:pin");
    setMessage("");
    setError("");
    try {
      await portalApi.post("/security/pin", {
        currentPin: pinForm.currentPin || undefined,
        newPin: pinForm.newPin,
      });
      setPinForm(EMPTY_PIN_FORM);
      setMessage("Portal PIN updated.");
      await loadSnapshot(false);
    } catch (err) {
      setError(err?.message || "Failed to update portal PIN");
    } finally {
      setBusyAction("");
    }
  };

  if (status === "unknown") {
    return <div style={{ padding: 24 }}>Checking customer portal session...</div>;
  }
  if (status !== "auth") {
    return <div style={{ padding: 24 }}>Please sign in to access the customer portal.</div>;
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(1000px 300px at 100% -10%, rgba(14,165,233,.12), transparent 60%)," +
          "radial-gradient(700px 260px at 0% 0%, rgba(16,185,129,.10), transparent 60%)," +
          "linear-gradient(180deg, #f8fafc 0%, #eef6ff 100%)",
        padding: 20,
      }}
    >
      <div style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gap: 20 }}>
        <header
          style={{
            background: "#0f172a",
            color: "#fff",
            borderRadius: 24,
            padding: 24,
            boxShadow: "0 18px 40px rgba(15, 23, 42, 0.18)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 20,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ color: "#93c5fd", fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>
                {overview?.tenant?.name || user?.tenantName || "Customer Portal"}
              </div>
              <h1 style={{ margin: "10px 0 6px", fontSize: 32 }}>
                {overview?.customer?.name || user?.displayName || "Customer"}
              </h1>
              <p style={{ margin: 0, color: "#cbd5e1", maxWidth: 720 }}>
                Account {overview?.customer?.accountNumber || user?.accountNumber || "-"} |{" "}
                {overview?.customer?.plan?.name || "No active plan"} | Service status{" "}
                {formatToken(overview?.customer?.status || "unknown")}
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="button" className="secondary" onClick={() => loadSnapshot(false)} disabled={loading}>
                {loading ? "Refreshing..." : "Refresh"}
              </button>
              <button type="button" className="secondary" onClick={handleLogout}>
                Logout
              </button>
            </div>
          </div>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <SummaryCard
            title="Outstanding Balance"
            value={overview ? formatMoney(overview.balances?.outstandingBalance || 0) : "-"}
            accent="#0f172a"
            hint={`${overview?.balances?.openInvoiceCount || 0} open invoices`}
          />
          <SummaryCard
            title="Open Tickets"
            value={overview?.support?.openTickets ?? "-"}
            accent="#1d4ed8"
            hint="Support requests awaiting closure"
          />
          <SummaryCard
            title="Active Incidents"
            value={overview?.network?.activeIncidents ?? "-"}
            accent="#b45309"
            hint="Current outages or maintenance affecting you"
          />
          <SummaryCard
            title="Assigned Equipment"
            value={overview?.network?.assignedAssets ?? "-"}
            accent="#166534"
            hint={overview?.customer?.connectionType ? formatToken(overview.customer.connectionType) : "Service assets"}
          />
        </div>

        {error ? (
          <div className="msg-err" role="alert">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="msg-ok" role="status">
            {message}
          </div>
        ) : null}

        <SectionCard
          title="Account Snapshot"
          subtitle="Your current service, billing preferences, and connection details."
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
            <div>
              <div style={{ color: "#64748b", fontSize: 13, fontWeight: 700 }}>Plan</div>
              <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700 }}>{overview?.customer?.plan?.name || "-"}</div>
              <div style={{ marginTop: 4, color: "#475569", fontSize: 14 }}>
                {overview?.customer?.plan?.speed ? `${overview.customer.plan.speed} Mbps` : "Speed not set"}
              </div>
            </div>
            <div>
              <div style={{ color: "#64748b", fontSize: 13, fontWeight: 700 }}>Next Expiry</div>
              <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700 }}>{formatDateTime(overview?.customer?.expiryDate)}</div>
              <div style={{ marginTop: 4, color: "#475569", fontSize: 14 }}>
                Status {formatToken(overview?.customer?.status || "unknown")}
              </div>
            </div>
            <div>
              <div style={{ color: "#64748b", fontSize: 13, fontWeight: 700 }}>Billing Preference</div>
              <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700 }}>
                {formatToken(overview?.customer?.billingProfile?.preferredPaymentMethod || "mpesa")}
              </div>
              <div style={{ marginTop: 4, color: "#475569", fontSize: 14 }}>
                Autopay {overview?.customer?.billingProfile?.autopayEnabled ? "enabled" : "disabled"}
              </div>
            </div>
            <div>
              <div style={{ color: "#64748b", fontSize: 13, fontWeight: 700 }}>Contact</div>
              <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700 }}>{overview?.customer?.phone || "-"}</div>
              <div style={{ marginTop: 4, color: "#475569", fontSize: 14 }}>{overview?.customer?.email || "No email on file"}</div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Portal Security"
          subtitle="Manage the PIN you can use for future customer portal sign-ins."
        >
          <form onSubmit={submitPin} className="stacked-form" style={{ padding: 0 }}>
            {overview?.customer?.portalProfile?.hasPin ? (
              <div className="field">
                <input
                  value={pinForm.currentPin}
                  onChange={(event) =>
                    setPinForm((current) => ({ ...current, currentPin: event.target.value }))
                  }
                  placeholder="Current PIN"
                  type="password"
                  inputMode="numeric"
                  autoComplete="current-password"
                  required
                />
              </div>
            ) : null}
            <div className="field">
              <input
                value={pinForm.newPin}
                onChange={(event) =>
                  setPinForm((current) => ({ ...current, newPin: event.target.value }))
                }
                placeholder="New PIN (4 to 8 digits)"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                required
              />
            </div>
            <button type="submit" className="primary" disabled={busyAction === "security:pin"}>
              {busyAction === "security:pin"
                ? "Updating..."
                : overview?.customer?.portalProfile?.hasPin
                  ? "Change PIN"
                  : "Set PIN"}
            </button>
          </form>
        </SectionCard>

        <SectionCard
          title="Pay Balance"
          subtitle="Start an M-Pesa STK request for an open invoice."
          actions={
            pendingPayment ? (
              <button
                type="button"
                className="secondary"
                onClick={checkPendingPayment}
                disabled={busyAction === "payment:status"}
              >
                {busyAction === "payment:status" ? "Checking..." : "Check Payment"}
              </button>
            ) : null
          }
        >
          <form onSubmit={submitMpesaPayment} className="stacked-form" style={{ padding: 0 }}>
            <div className="field">
              <select
                value={paymentForm.invoiceId}
                onChange={(event) =>
                  setPaymentForm((current) => ({ ...current, invoiceId: event.target.value }))
                }
              >
                <option value="">Choose open invoice</option>
                {payableInvoices.map((invoice) => (
                  <option key={invoice._id} value={invoice._id}>
                    {invoice.invoiceNumber || "Draft invoice"} | {formatMoney(invoice.balanceDue, invoice.currency)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <input
                value={paymentForm.phone}
                onChange={(event) =>
                  setPaymentForm((current) => ({ ...current, phone: event.target.value }))
                }
                placeholder="M-Pesa phone number"
              />
            </div>
            <button
              type="submit"
              className="primary"
              disabled={busyAction === "payment:stk" || payableInvoices.length === 0}
            >
              {busyAction === "payment:stk" ? "Sending STK..." : "Pay With M-Pesa"}
            </button>
          </form>
          {pendingPayment ? (
            <div style={{ marginTop: 12, color: "#475569", fontSize: 14 }}>
              Pending payment {pendingPayment.paymentId}: {formatToken(pendingPayment.status)}
              {pendingPayment.transactionId ? ` | ${pendingPayment.transactionId}` : ""}
            </div>
          ) : null}
          {!payableInvoices.length ? (
            <div style={{ marginTop: 12, color: "#475569", fontSize: 14 }}>
              You do not have an open invoice balance right now.
            </div>
          ) : null}
        </SectionCard>

        <SectionCard title="Invoices" subtitle="Review your recent invoices and outstanding balances.">
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Due Date</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Balance</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.length ? (
                  invoices.map((invoice) => {
                    const pill = badge(invoice.status);
                    return (
                      <tr key={invoice._id}>
                        <td>
                          <strong>{invoice.invoiceNumber || "Draft invoice"}</strong>
                          <div style={{ marginTop: 4, color: "#64748b", fontSize: 13 }}>
                            {formatToken(invoice.billingReason)}
                          </div>
                        </td>
                        <td>{formatDateTime(invoice.dueDate)}</td>
                        <td>
                          <span style={{ display: "inline-flex", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, ...pill }}>
                            {formatToken(invoice.status)}
                          </span>
                        </td>
                        <td>{formatMoney(invoice.total, invoice.currency)}</td>
                        <td>{formatMoney(invoice.balanceDue, invoice.currency)}</td>
                        <td className="actions" style={{ textAlign: "right" }}>
                          {Number(invoice.balanceDue || 0) > 0 ? (
                            <button
                              type="button"
                              className="secondary table-action"
                              onClick={() => startInvoicePayment(invoice)}
                            >
                              Pay
                            </button>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center" }}>No invoices available.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard title="Payments" subtitle="Track recent payments and settlement history.">
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Method</th>
                  <th>Status</th>
                  <th>Amount</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {payments.length ? (
                  payments.map((payment) => {
                    const pill = badge(payment.status);
                    return (
                      <tr key={payment._id}>
                        <td>{formatDateTime(payment.createdAt)}</td>
                        <td>{formatToken(payment.method)}</td>
                        <td>
                          <span style={{ display: "inline-flex", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, ...pill }}>
                            {formatToken(payment.status)}
                          </span>
                        </td>
                        <td>{formatMoney(payment.amount)}</td>
                        <td>{payment.transactionId || payment.invoiceNumber || "-"}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center" }}>No payments recorded yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
          <SectionCard title="Support Tickets" subtitle="Review open requests and create a new support ticket.">
            <div className="table-wrapper" style={{ marginBottom: 16 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Opened</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.length ? (
                    tickets.map((ticket) => (
                      <tr key={ticket._id}>
                        <td>
                          <strong>{ticket.ticketNumber}</strong>
                          <div style={{ marginTop: 4, color: "#0f172a", fontSize: 13 }}>{ticket.title}</div>
                        </td>
                        <td>
                          <span style={{ display: "inline-flex", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, ...badge(ticket.status) }}>
                            {formatToken(ticket.status)}
                          </span>
                        </td>
                        <td>{formatToken(ticket.priority)}</td>
                        <td>{formatDateTime(ticket.openedAt)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} style={{ textAlign: "center" }}>No support tickets yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <form onSubmit={submitTicket} className="stacked-form" style={{ padding: 0 }}>
              <div className="field">
                <input
                  value={ticketForm.title}
                  onChange={(event) => setTicketForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="What do you need help with?"
                  required
                />
              </div>
              <div className="field">
                <input
                  value={ticketForm.category}
                  onChange={(event) => setTicketForm((current) => ({ ...current, category: event.target.value }))}
                  placeholder="Category (billing, outage, install, etc.)"
                />
              </div>
              <div className="field">
                <select
                  value={ticketForm.priority}
                  onChange={(event) => setTicketForm((current) => ({ ...current, priority: event.target.value }))}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div className="field">
                <select
                  value={ticketForm.assetId}
                  onChange={(event) => setTicketForm((current) => ({ ...current, assetId: event.target.value }))}
                >
                  <option value="">No equipment selected</option>
                  {assets.map((asset) => (
                    <option key={asset._id} value={asset._id}>
                      {asset.assetTag} | {asset.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ gridColumn: "span 3" }}>
                <textarea
                  value={ticketForm.description}
                  onChange={(event) => setTicketForm((current) => ({ ...current, description: event.target.value }))}
                  rows={3}
                  placeholder="Describe the issue, what you have noticed, and when it started."
                />
              </div>
              <div className="field" style={{ gridColumn: "span 2" }}>
                <textarea
                  value={ticketForm.note}
                  onChange={(event) => setTicketForm((current) => ({ ...current, note: event.target.value }))}
                  rows={2}
                  placeholder="Optional extra note for the support team"
                />
              </div>
              <button type="submit" className="primary" disabled={busyAction === "ticket:create"}>
                {busyAction === "ticket:create" ? "Submitting..." : "Submit Support Request"}
              </button>
            </form>
          </SectionCard>

          <SectionCard title="Network Incidents" subtitle="See active outages or maintenance affecting your service.">
            <div style={{ display: "grid", gap: 12 }}>
              {incidents.length ? (
                incidents.map((incident) => (
                  <article
                    key={incident._id}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 16,
                      padding: 16,
                      background: "#f8fafc",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div>
                        <strong>{incident.incidentNumber}</strong>
                        <div style={{ marginTop: 6, fontSize: 16, fontWeight: 700 }}>{incident.title}</div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ display: "inline-flex", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, ...badge(incident.severity) }}>
                          {formatToken(incident.severity)}
                        </span>
                        <span style={{ display: "inline-flex", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, ...badge(incident.status) }}>
                          {formatToken(incident.status)}
                        </span>
                      </div>
                    </div>
                    <p style={{ margin: "10px 0 0", color: "#475569", fontSize: 14 }}>
                      {incident.summary || "The network team is tracking this incident."}
                    </p>
                    <div style={{ marginTop: 10, color: "#64748b", fontSize: 13 }}>
                      {incident.site || "Unknown site"} | Started {formatDateTime(incident.startedAt)}
                    </div>
                  </article>
                ))
              ) : (
                <div style={{ color: "#475569", fontSize: 14 }}>
                  No active incidents are currently affecting your account.
                </div>
              )}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
