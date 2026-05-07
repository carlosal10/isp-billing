import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/apiClient";
import { useAuth } from "../context/AuthContext";

const EMPTY_TICKET_FORM = {
  title: "",
  description: "",
  priority: "medium",
  status: "open",
  channel: "internal",
  category: "",
  customerQuery: "",
  customerId: "",
  assetId: "",
  assigneeName: "",
  assigneeEmail: "",
  tags: "",
  note: "",
};

const EMPTY_WORK_ORDER_FORM = {
  summary: "",
  type: "repair",
  priority: "medium",
  status: "open",
  customerQuery: "",
  customerId: "",
  assetId: "",
  ticketId: "",
  technicianName: "",
  technicianPhone: "",
  site: "",
  scheduledFor: "",
  resolutionNotes: "",
};

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "-";
}

function toDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60 * 1000).toISOString().slice(0, 16);
}

function formatToken(value) {
  return String(value || "")
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function statusBadge(value) {
  const status = String(value || "").toLowerCase();
  if (["resolved", "completed", "closed"].includes(status)) {
    return { background: "#dcfce7", color: "#166534" };
  }
  if (["scheduled", "waiting"].includes(status)) {
    return { background: "#fef3c7", color: "#92400e" };
  }
  if (["cancelled"].includes(status)) {
    return { background: "#fee2e2", color: "#991b1b" };
  }
  if (["in_progress", "dispatched", "urgent", "high"].includes(status)) {
    return { background: "#dbeafe", color: "#1d4ed8" };
  }
  return { background: "#e2e8f0", color: "#475569" };
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
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          marginBottom: 16,
          flexWrap: "wrap",
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

function SummaryCard({ title, value, accent, hint }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 16,
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

function CustomerSearchResults({ results, onSelect }) {
  if (!results.length) return null;
  return (
    <div
      style={{
        marginTop: 8,
        border: "1px solid #e2e8f0",
        borderRadius: 14,
        overflow: "hidden",
        background: "#fff",
        boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
      }}
    >
      {results.map((customer) => (
        <button
          key={customer._id}
          type="button"
          onClick={() => onSelect(customer)}
          style={{
            width: "100%",
            textAlign: "left",
            border: "none",
            borderBottom: "1px solid #f1f5f9",
            background: "#fff",
            padding: "12px 14px",
            cursor: "pointer",
          }}
        >
          <strong>{customer.name || "Unnamed customer"}</strong>
          <div style={{ marginTop: 4, color: "#64748b", fontSize: 13 }}>
            {customer.accountNumber || "No account"} | {customer.phone || customer.email || "No contact"}
          </div>
        </button>
      ))}
    </div>
  );
}

async function fetchSupportSnapshot() {
  const [summaryRes, ticketsRes, workOrdersRes, assetsRes] = await Promise.all([
    api.get("/support/summary"),
    api.get("/support/tickets", { params: { limit: 200 } }),
    api.get("/support/work-orders", { params: { limit: 200 } }),
    api.get("/service-ops/assets"),
  ]);

  return {
    summary: summaryRes.data || {},
    tickets: Array.isArray(ticketsRes.data) ? ticketsRes.data : [],
    workOrders: Array.isArray(workOrdersRes.data) ? workOrdersRes.data : [],
    assets: Array.isArray(assetsRes.data) ? assetsRes.data : [],
  };
}

function ticketPayloadFromForm(form, isUpdate) {
  const payload = {
    title: form.title,
    description: form.description || undefined,
    priority: form.priority,
    status: form.status,
    channel: form.channel,
    category: form.category || undefined,
    customerId: form.customerId || null,
    assetId: form.assetId || null,
    assigneeName: form.assigneeName || undefined,
    assigneeEmail: form.assigneeEmail || undefined,
    tags: form.tags
      ? form.tags.split(",").map((item) => item.trim()).filter(Boolean)
      : [],
  };

  if (form.note.trim()) {
    if (isUpdate) {
      payload.note = form.note.trim();
    } else {
      payload.notes = [{ body: form.note.trim() }];
    }
  }

  return payload;
}

function workOrderPayloadFromForm(form) {
  return {
    summary: form.summary,
    type: form.type,
    priority: form.priority,
    status: form.status,
    customerId: form.customerId || null,
    assetId: form.assetId || null,
    ticketId: form.ticketId || null,
    technicianName: form.technicianName || undefined,
    technicianPhone: form.technicianPhone || undefined,
    site: form.site || undefined,
    scheduledFor: form.scheduledFor || null,
    resolutionNotes: form.resolutionNotes || undefined,
  };
}

export default function SupportOperations() {
  const { role, status } = useAuth();
  const canManage = role === "owner" || role === "admin";

  const [summary, setSummary] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [workOrders, setWorkOrders] = useState([]);
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [editingTicketId, setEditingTicketId] = useState("");
  const [editingWorkOrderId, setEditingWorkOrderId] = useState("");

  const [ticketForm, setTicketForm] = useState(EMPTY_TICKET_FORM);
  const [workOrderForm, setWorkOrderForm] = useState(EMPTY_WORK_ORDER_FORM);

  const [ticketCustomerResults, setTicketCustomerResults] = useState([]);
  const [ticketCustomerLoading, setTicketCustomerLoading] = useState(false);
  const [workOrderCustomerResults, setWorkOrderCustomerResults] = useState([]);
  const [workOrderCustomerLoading, setWorkOrderCustomerLoading] = useState(false);

  const assetOptions = useMemo(
    () => assets.filter((asset) => asset.status !== "retired"),
    [assets]
  );
  const ticketOptions = useMemo(
    () => tickets.filter((ticket) => ticket.status !== "closed"),
    [tickets]
  );

  const loadSnapshot = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const snapshot = await fetchSupportSnapshot();
      setSummary(snapshot.summary);
      setTickets(snapshot.tickets);
      setWorkOrders(snapshot.workOrders);
      setAssets(snapshot.assets);
      setError("");
    } catch (err) {
      console.error("Failed to load support operations snapshot:", err);
      setError(err?.message || "Failed to load support operations data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (status !== "auth" || !canManage) return;
    loadSnapshot(true);
  }, [status, canManage]);

  useEffect(() => {
    if (!ticketForm.customerQuery.trim() || ticketForm.customerId) {
      setTicketCustomerResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setTicketCustomerLoading(true);
      try {
        const { data } = await api.get("/customers/search", {
          params: { query: ticketForm.customerQuery.trim() },
        });
        setTicketCustomerResults(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Ticket customer search failed:", err);
      } finally {
        setTicketCustomerLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [ticketForm.customerId, ticketForm.customerQuery]);

  useEffect(() => {
    if (!workOrderForm.customerQuery.trim() || workOrderForm.customerId) {
      setWorkOrderCustomerResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setWorkOrderCustomerLoading(true);
      try {
        const { data } = await api.get("/customers/search", {
          params: { query: workOrderForm.customerQuery.trim() },
        });
        setWorkOrderCustomerResults(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Work order customer search failed:", err);
      } finally {
        setWorkOrderCustomerLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [workOrderForm.customerId, workOrderForm.customerQuery]);

  const handleTicketChange = (event) => {
    const { name, value } = event.target;
    setTicketForm((current) => ({
      ...current,
      [name]: value,
      ...(name === "customerQuery" ? { customerId: "" } : {}),
    }));
  };

  const handleWorkOrderChange = (event) => {
    const { name, value } = event.target;
    setWorkOrderForm((current) => ({
      ...current,
      [name]: value,
      ...(name === "customerQuery" ? { customerId: "" } : {}),
    }));
  };

  const resetTicketForm = () => {
    setEditingTicketId("");
    setTicketForm(EMPTY_TICKET_FORM);
    setTicketCustomerResults([]);
  };

  const resetWorkOrderForm = () => {
    setEditingWorkOrderId("");
    setWorkOrderForm(EMPTY_WORK_ORDER_FORM);
    setWorkOrderCustomerResults([]);
  };

  const startTicketEdit = (ticket) => {
    setEditingTicketId(ticket._id);
    setTicketForm({
      title: ticket.title || "",
      description: ticket.description || "",
      priority: ticket.priority || "medium",
      status: ticket.status || "open",
      channel: ticket.channel || "internal",
      category: ticket.category || "",
      customerQuery: ticket.customer
        ? `${ticket.customer.name || "Customer"} (${ticket.customer.accountNumber || "N/A"})`
        : "",
      customerId: ticket.customer?._id || "",
      assetId: ticket.asset?._id || "",
      assigneeName: ticket.assigneeName || "",
      assigneeEmail: ticket.assigneeEmail || "",
      tags: Array.isArray(ticket.tags) ? ticket.tags.join(", ") : "",
      note: "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const startWorkOrderEdit = (order) => {
    setEditingWorkOrderId(order._id);
    setWorkOrderForm({
      summary: order.summary || "",
      type: order.type || "repair",
      priority: order.priority || "medium",
      status: order.status || "open",
      customerQuery: order.customer
        ? `${order.customer.name || "Customer"} (${order.customer.accountNumber || "N/A"})`
        : "",
      customerId: order.customer?._id || "",
      assetId: order.asset?._id || "",
      ticketId: order.ticket?._id || "",
      technicianName: order.technicianName || "",
      technicianPhone: order.technicianPhone || "",
      site: order.site || "",
      scheduledFor: toDateTimeLocal(order.scheduledFor),
      resolutionNotes: order.resolutionNotes || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submitTicket = async (event) => {
    event.preventDefault();
    setBusyAction("ticket:save");
    setMessage("");
    setError("");
    try {
      const payload = ticketPayloadFromForm(ticketForm, Boolean(editingTicketId));
      if (editingTicketId) {
        await api.put(`/support/tickets/${editingTicketId}`, payload);
        setMessage("Support ticket updated.");
      } else {
        await api.post("/support/tickets", payload);
        setMessage("Support ticket created.");
      }
      resetTicketForm();
      await loadSnapshot(false);
    } catch (err) {
      setError(err?.message || "Failed to save support ticket");
    } finally {
      setBusyAction("");
    }
  };

  const submitWorkOrder = async (event) => {
    event.preventDefault();
    setBusyAction("work-order:save");
    setMessage("");
    setError("");
    try {
      const payload = workOrderPayloadFromForm(workOrderForm);
      if (editingWorkOrderId) {
        await api.put(`/support/work-orders/${editingWorkOrderId}`, payload);
        setMessage("Work order updated.");
      } else {
        await api.post("/support/work-orders", payload);
        setMessage("Work order created.");
      }
      resetWorkOrderForm();
      await loadSnapshot(false);
    } catch (err) {
      setError(err?.message || "Failed to save work order");
    } finally {
      setBusyAction("");
    }
  };

  if (status === "unknown") {
    return <div style={{ padding: 20 }}>Checking session...</div>;
  }
  if (status !== "auth") {
    return <div style={{ padding: 20 }}>Please log in to manage support and field operations.</div>;
  }
  if (!canManage) {
    return <div style={{ padding: 20 }}>Support operations are limited to tenant owners and admins.</div>;
  }

  return (
    <div
      style={{
        padding: 20,
        display: "grid",
        gap: 20,
        background: "linear-gradient(180deg, #f8fafc 0%, #eefbf6 100%)",
        minHeight: "100%",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <SummaryCard title="Open Tickets" value={summary?.openTickets ?? "-"} accent="#0f172a" hint={`${summary?.inProgressTickets ?? 0} in progress`} />
        <SummaryCard title="Overdue Tickets" value={summary?.overdueTickets ?? "-"} accent="#b91c1c" hint={`${summary?.waitingTickets ?? 0} waiting`} />
        <SummaryCard title="Active Work Orders" value={summary?.activeWorkOrders ?? "-"} accent="#1d4ed8" hint={`${summary?.scheduledWorkOrders ?? 0} scheduled`} />
        <SummaryCard title="Completed Today" value={summary?.completedWorkOrders ?? "-"} accent="#166534" hint={`${summary?.openWorkOrders ?? 0} still open`} />
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
        title={editingTicketId ? "Edit Support Ticket" : "Create Support Ticket"}
        subtitle="Capture customer issues, assign owners, and keep an SLA-backed record of support activity."
        actions={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {editingTicketId ? (
              <button type="button" className="secondary" onClick={resetTicketForm}>
                Cancel Edit
              </button>
            ) : null}
            <button type="button" className="secondary" onClick={() => loadSnapshot(false)} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        }
      >
        <form onSubmit={submitTicket} className="stacked-form" style={{ padding: 0 }}>
          <div className="field">
            <input name="title" value={ticketForm.title} onChange={handleTicketChange} placeholder="Ticket title" required />
          </div>
          <div className="field">
            <select name="priority" value={ticketForm.priority} onChange={handleTicketChange}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div className="field">
            <select name="status" value={ticketForm.status} onChange={handleTicketChange}>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="waiting">Waiting</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div className="field">
            <select name="channel" value={ticketForm.channel} onChange={handleTicketChange}>
              <option value="internal">Internal</option>
              <option value="phone">Phone</option>
              <option value="email">Email</option>
              <option value="walk-in">Walk-In</option>
              <option value="portal">Portal</option>
            </select>
          </div>
          <div className="field">
            <input name="category" value={ticketForm.category} onChange={handleTicketChange} placeholder="Category" />
          </div>
          <div className="field">
            <input name="assigneeName" value={ticketForm.assigneeName} onChange={handleTicketChange} placeholder="Assignee name" />
          </div>
          <div className="field">
            <input name="assigneeEmail" value={ticketForm.assigneeEmail} onChange={handleTicketChange} placeholder="Assignee email" />
          </div>
          <div className="field">
            <input name="tags" value={ticketForm.tags} onChange={handleTicketChange} placeholder="Tags (comma separated)" />
          </div>
          <div className="field" style={{ position: "relative", gridColumn: "span 2" }}>
            <input
              name="customerQuery"
              value={ticketForm.customerQuery}
              onChange={handleTicketChange}
              placeholder="Search customer by name or account number"
            />
            {ticketCustomerLoading ? <div className="help-text">Searching...</div> : null}
            <CustomerSearchResults
              results={ticketCustomerResults}
              onSelect={(customer) => {
                setTicketForm((current) => ({
                  ...current,
                  customerId: customer._id,
                  customerQuery: `${customer.name} (${customer.accountNumber || "N/A"})`,
                }));
                setTicketCustomerResults([]);
              }}
            />
          </div>
          <div className="field">
            <select name="assetId" value={ticketForm.assetId} onChange={handleTicketChange}>
              <option value="">No asset linked</option>
              {assetOptions.map((asset) => (
                <option key={asset._id} value={asset._id}>
                  {asset.assetTag} | {asset.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ gridColumn: "span 3" }}>
            <textarea
              name="description"
              value={ticketForm.description}
              onChange={handleTicketChange}
              rows={3}
              placeholder="Describe the issue, symptoms, or customer request"
            />
          </div>
          <div className="field" style={{ gridColumn: "span 2" }}>
            <textarea
              name="note"
              value={ticketForm.note}
              onChange={handleTicketChange}
              rows={2}
              placeholder={editingTicketId ? "Add an internal note for this update" : "Optional opening note"}
            />
          </div>
          <button type="submit" className="primary" disabled={busyAction === "ticket:save"}>
            {busyAction === "ticket:save"
              ? "Saving..."
              : editingTicketId
                ? "Update Ticket"
                : "Create Ticket"}
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Support Tickets" subtitle="Track customer-facing issues, SLA deadlines, and linked work orders.">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Customer</th>
                <th>Asset</th>
                <th>SLA</th>
                <th>Work Order</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tickets.length ? (
                tickets.map((ticket) => {
                  const priorityBadge = statusBadge(ticket.priority);
                  const statusPill = statusBadge(ticket.status);
                  return (
                    <tr key={ticket._id}>
                      <td>
                        <strong>{ticket.ticketNumber}</strong>
                        <div style={{ marginTop: 4, color: "#0f172a", fontSize: 13 }}>{ticket.title}</div>
                        <div style={{ marginTop: 4, color: "#64748b", fontSize: 12 }}>{formatToken(ticket.channel)}</div>
                      </td>
                      <td>
                        <span style={{ display: "inline-flex", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, ...priorityBadge }}>
                          {formatToken(ticket.priority)}
                        </span>
                      </td>
                      <td>
                        <span style={{ display: "inline-flex", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, ...statusPill }}>
                          {formatToken(ticket.status)}
                        </span>
                      </td>
                      <td>
                        {ticket.customer ? (
                          <>
                            <strong>{ticket.customer.name}</strong>
                            <div style={{ marginTop: 4, color: "#64748b", fontSize: 13 }}>{ticket.customer.accountNumber || "-"}</div>
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>{ticket.asset ? `${ticket.asset.assetTag} | ${ticket.asset.name || "-"}` : "-"}</td>
                      <td>
                        <div style={{ color: "#0f172a", fontSize: 13 }}>
                          Response: {formatDateTime(ticket.firstResponseDueAt)}
                        </div>
                        <div style={{ marginTop: 4, color: "#64748b", fontSize: 13 }}>
                          Resolve: {formatDateTime(ticket.resolutionDueAt)}
                        </div>
                      </td>
                      <td>{ticket.workOrder ? `${ticket.workOrder.orderNumber} | ${formatToken(ticket.workOrder.status)}` : "-"}</td>
                      <td className="actions" style={{ textAlign: "right" }}>
                        <button type="button" className="secondary table-action" onClick={() => startTicketEdit(ticket)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center" }}>No support tickets yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title={editingWorkOrderId ? "Edit Work Order" : "Create Work Order"}
        subtitle="Dispatch installs, repairs, and maintenance jobs while keeping them tied back to support tickets."
        actions={
          editingWorkOrderId ? (
            <button type="button" className="secondary" onClick={resetWorkOrderForm}>
              Cancel Edit
            </button>
          ) : null
        }
      >
        <form onSubmit={submitWorkOrder} className="stacked-form" style={{ padding: 0 }}>
          <div className="field">
            <input name="summary" value={workOrderForm.summary} onChange={handleWorkOrderChange} placeholder="Work order summary" required />
          </div>
          <div className="field">
            <select name="type" value={workOrderForm.type} onChange={handleWorkOrderChange}>
              <option value="install">Install</option>
              <option value="repair">Repair</option>
              <option value="maintenance">Maintenance</option>
              <option value="pickup">Pickup</option>
              <option value="survey">Survey</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="field">
            <select name="priority" value={workOrderForm.priority} onChange={handleWorkOrderChange}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div className="field">
            <select name="status" value={workOrderForm.status} onChange={handleWorkOrderChange}>
              <option value="open">Open</option>
              <option value="scheduled">Scheduled</option>
              <option value="dispatched">Dispatched</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="field" style={{ position: "relative", gridColumn: "span 2" }}>
            <input
              name="customerQuery"
              value={workOrderForm.customerQuery}
              onChange={handleWorkOrderChange}
              placeholder="Search customer by name or account number"
            />
            {workOrderCustomerLoading ? <div className="help-text">Searching...</div> : null}
            <CustomerSearchResults
              results={workOrderCustomerResults}
              onSelect={(customer) => {
                setWorkOrderForm((current) => ({
                  ...current,
                  customerId: customer._id,
                  customerQuery: `${customer.name} (${customer.accountNumber || "N/A"})`,
                }));
                setWorkOrderCustomerResults([]);
              }}
            />
          </div>
          <div className="field">
            <select name="assetId" value={workOrderForm.assetId} onChange={handleWorkOrderChange}>
              <option value="">No asset linked</option>
              {assetOptions.map((asset) => (
                <option key={asset._id} value={asset._id}>
                  {asset.assetTag} | {asset.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <select name="ticketId" value={workOrderForm.ticketId} onChange={handleWorkOrderChange}>
              <option value="">No ticket linked</option>
              {ticketOptions.map((ticket) => (
                <option key={ticket._id} value={ticket._id}>
                  {ticket.ticketNumber} | {ticket.title}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <input name="technicianName" value={workOrderForm.technicianName} onChange={handleWorkOrderChange} placeholder="Technician name" />
          </div>
          <div className="field">
            <input name="technicianPhone" value={workOrderForm.technicianPhone} onChange={handleWorkOrderChange} placeholder="Technician phone" />
          </div>
          <div className="field">
            <input name="site" value={workOrderForm.site} onChange={handleWorkOrderChange} placeholder="Site or area" />
          </div>
          <div className="field">
            <input type="datetime-local" name="scheduledFor" value={workOrderForm.scheduledFor} onChange={handleWorkOrderChange} />
            <p className="help-text">Optional dispatch or appointment time.</p>
          </div>
          <div className="field" style={{ gridColumn: "span 3" }}>
            <textarea
              name="resolutionNotes"
              value={workOrderForm.resolutionNotes}
              onChange={handleWorkOrderChange}
              rows={3}
              placeholder="Dispatch notes, parts used, or resolution details"
            />
          </div>
          <button type="submit" className="primary" disabled={busyAction === "work-order:save"}>
            {busyAction === "work-order:save"
              ? "Saving..."
              : editingWorkOrderId
                ? "Update Work Order"
                : "Create Work Order"}
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Work Orders" subtitle="Coordinate field dispatch, installs, repairs, and maintenance tasks.">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Type</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Customer</th>
                <th>Schedule</th>
                <th>Linked Ticket</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {workOrders.length ? (
                workOrders.map((order) => {
                  const priorityBadge = statusBadge(order.priority);
                  const statusPill = statusBadge(order.status);
                  return (
                    <tr key={order._id}>
                      <td>
                        <strong>{order.orderNumber}</strong>
                        <div style={{ marginTop: 4, color: "#0f172a", fontSize: 13 }}>{order.summary}</div>
                        <div style={{ marginTop: 4, color: "#64748b", fontSize: 12 }}>
                          {order.technicianName || "No technician"} {order.site ? `| ${order.site}` : ""}
                        </div>
                      </td>
                      <td>{formatToken(order.type)}</td>
                      <td>
                        <span style={{ display: "inline-flex", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, ...priorityBadge }}>
                          {formatToken(order.priority)}
                        </span>
                      </td>
                      <td>
                        <span style={{ display: "inline-flex", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, ...statusPill }}>
                          {formatToken(order.status)}
                        </span>
                      </td>
                      <td>
                        {order.customer ? (
                          <>
                            <strong>{order.customer.name}</strong>
                            <div style={{ marginTop: 4, color: "#64748b", fontSize: 13 }}>{order.customer.accountNumber || "-"}</div>
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>{formatDateTime(order.scheduledFor)}</td>
                      <td>{order.ticket ? `${order.ticket.ticketNumber} | ${formatToken(order.ticket.status)}` : "-"}</td>
                      <td className="actions" style={{ textAlign: "right" }}>
                        <button type="button" className="secondary table-action" onClick={() => startWorkOrderEdit(order)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center" }}>No work orders yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {loading ? (
          <div style={{ marginTop: 12, color: "#64748b", fontSize: 14 }}>Loading support operations data...</div>
        ) : null}
      </SectionCard>
    </div>
  );
}
