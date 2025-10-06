import "./PaymentsModal.css";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd, MdEdit, MdDelete, MdClose } from "react-icons/md";
import { api } from "../lib/apiClient";

export default function PaymentsModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState("payments"); // "payments" | "invoices"
  const [payments, setPayments] = useState([]);
  const [invoices, setInvoices] = useState([]);

  // ------- Manual validation state -------
  const [searchTerm, setSearchTerm] = useState("");
  const [customerResults, setCustomerResults] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [manualPayment, setManualPayment] = useState({
    customerId: null,
    accountNumber: "",
    transactionId: "",
    amount: "",
    method: "",
    // Backdating/extension controls
    paidAt: "",       // datetime-local
    backdateTo: "",   // date
    expiryDate: "",   // date override
    extendDays: "",   // number
  });

  // ------- Edit/Delete state -------
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editPayment, setEditPayment] = useState(null); // current payment being edited
  const [confirm, setConfirm] = useState({ open: false, id: null, loading: false, message: "" });

  const dropdownRef = useRef(null);

  // fetch on open
  useEffect(() => {
    if (!isOpen) return;
    fetchPayments();
    fetchInvoices();
  }, [isOpen]);

  // close dropdown on outside click
  useEffect(() => {
    function onDocClick(e) {
      if (!dropdownRef.current) return;
      if (!dropdownRef.current.contains(e.target)) {
        setCustomerResults([]);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // ---------- API helpers ----------
  const getErrMsg = (err, fallback = "Request failed") =>
    err?.response?.data?.error ||
    err?.response?.data?.message ||
    err?.message ||
    fallback;

  const fetchPayments = async () => {
    try {
      const { data } = await api.get(`/payments`);
      setPayments(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load payments:", err);
    }
  };

  const fetchInvoices = async () => {
    try {
      const { data } = await api.get(`/invoices`);
      setInvoices(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load invoices:", err);
    }
  };

  // Search customers for manual validation
  const searchCustomers = async (q) => {
    const query = q.trim();
    if (!query) {
      setCustomerResults([]);
      setSearchError("");
      return;
    }
    setLoadingSearch(true);
    setSearchError("");
    try {
      const { data } = await api.get(`/customers/search`, { params: { query } });
      setCustomerResults(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Customer search failed:", err);
      setSearchError("Search failed");
      setCustomerResults([]);
    } finally {
      setLoadingSearch(false);
    }
  };

  // debounce search
  useEffect(() => {
    const id = setTimeout(() => searchCustomers(searchTerm), 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  const handleManualValidation = async (e) => {
    e.preventDefault();
    if (!manualPayment.customerId) {
      alert("Please select a customer from the search results first.");
      return;
    }
    if (!manualPayment.transactionId.trim()) {
      alert("Transaction ID is required.");
      return;
    }

    try {
      await api.post(`/payments/manual`, {
        customerId: manualPayment.customerId,
        accountNumber: manualPayment.accountNumber,
        transactionId: manualPayment.transactionId,
        amount: manualPayment.amount !== "" ? Number(manualPayment.amount) : undefined,
        method: manualPayment.method || "manual",
        // Backdating
        paidAt: manualPayment.paidAt ? new Date(manualPayment.paidAt).toISOString() : undefined,
        backdateTo: manualPayment.backdateTo || undefined,
        expiryDate: manualPayment.expiryDate || undefined,
        extendDays: manualPayment.extendDays !== "" ? Number(manualPayment.extendDays) : undefined,
        validatedBy: "Admin Panel",
        notes: "Manual validation from PaymentsModal",
      });

      alert("Payment validated successfully!");
      setManualPayment({
        customerId: null,
        accountNumber: "",
        transactionId: "",
        amount: "",
        method: "",
        paidAt: "",
        backdateTo: "",
        expiryDate: "",
        extendDays: "",
      });
      setSearchTerm("");
      setCustomerResults([]);
      fetchPayments();
      fetchInvoices();
    } catch (err) {
      console.error("Validation failed:", err);
      alert(getErrMsg(err, "Error validating payment"));
    }
  };

  const markInvoicePaid = async (id) => {
    try {
      await api.put(`/invoices/${id}/pay`);
      alert("Invoice marked as paid!");
      fetchInvoices();
    } catch (err) {
      console.error("Failed to mark paid:", err);
      alert(getErrMsg(err, "Error marking invoice as paid"));
    }
  };

  const generateInvoice = async (id) => {
    try {
      await api.post(`/invoices/${id}/generate`);
      alert("Invoice generated successfully!");
      fetchInvoices();
    } catch (err) {
      console.error("Failed to generate invoice:", err);
      alert(getErrMsg(err, "Error generating invoice"));
    }
  };

  const viewInvoicePDF = async (id) => {
    try {
      const res = await api.get(`/invoices/${id}/pdf`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      window.open(url, "_blank");
    } catch (err) {
      console.error("Failed to fetch PDF:", err);
      alert(getErrMsg(err, "Error fetching invoice PDF"));
    }
  };

  // ---------- Edit / Delete handlers ----------
  const openEdit = (p) => {
    setEditPayment({
      _id: p._id,
      transactionId: p.transactionId || "",
      amount: p.amount ?? "",
      method: p.method || "manual",
      notes: p.notes || "",
      status: p.status || "Validated",
      // Backdating fields
      validatedAt: "",
      backdateTo: "",
      expiryDate: "",
      extendDays: "",
    });
    setEditOpen(true);
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    if (!editPayment?._id) return;
    setEditSaving(true);
    try {
      // Assumes backend route: PUT /api/payments/:id
      await api.put(`/payments/${editPayment._id}`, {
        transactionId: String(editPayment.transactionId || "").trim(),
        amount: editPayment.amount === "" ? undefined : Number(editPayment.amount),
        method: editPayment.method || "manual",
        notes: editPayment.notes || undefined,
        status: editPayment.status || undefined, // e.g., Validated/Failed/Refunded
        // Backdating controls for edit
        validatedAt: editPayment.validatedAt ? new Date(editPayment.validatedAt).toISOString() : undefined,
        backdateTo: editPayment.backdateTo || undefined,
        expiryDate: editPayment.expiryDate || undefined,
        extendDays: editPayment.extendDays !== "" ? Number(editPayment.extendDays) : undefined,
      });

      // Optimistic refresh
      await fetchPayments();
      setEditOpen(false);
      setEditPayment(null);
    } catch (err) {
      alert(getErrMsg(err, "Failed to save changes"));
    } finally {
      setEditSaving(false);
    }
  };

  const askDelete = (id) => {
    setConfirm({
      open: true,
      id,
      loading: false,
      message:
        "Deleting a validated payment may impact invoices, balances, and renewal history. Proceed?",
    });
  };

  const doDelete = async () => {
    if (!confirm.id) return;
    setConfirm((s) => ({ ...s, loading: true }));
    try {
      // Assumes backend route: DELETE /api/payments/:id
      await api.delete(`/payments/${confirm.id}`);
      setPayments((list) => list.filter((p) => p._id !== confirm.id));
      setConfirm({ open: false, id: null, loading: false, message: "" });
      // Consider refreshing invoices if they depend on payments
      fetchInvoices();
    } catch (err) {
      alert(getErrMsg(err, "Failed to delete payment"));
      setConfirm((s) => ({ ...s, loading: false }));
    }
  };

  const hasNoSearchResults = useMemo(
    () => !loadingSearch && searchTerm.trim() && customerResults.length === 0,
    [loadingSearch, searchTerm, customerResults.length]
  );

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content large">
        <span className="close" onClick={onClose} role="button" aria-label="Close">
          <FaTimes />
        </span>

        {/* Tabs */}
        <div className="tabs">
          <button className={activeTab === "payments" ? "active" : ""} onClick={() => setActiveTab("payments")}>
            Payments
          </button>
          <button className={activeTab === "invoices" ? "active" : ""} onClick={() => setActiveTab("invoices")}>
            Invoices
          </button>
        </div>

        {/* ===== Payments Tab ===== */}
        {activeTab === "payments" && (
          <>
            <h2>Payments</h2>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Customer</th>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p._id}>
                      <td title={p._id}>{p._id}</td>
                      <td>{p.customerName || p.customer?.name || "-"}</td>
                      <td>{p.amount}</td>
                      <td>{p.method}</td>
                      <td>{p.status}</td>
                      <td>{p.createdAt ? new Date(p.createdAt).toLocaleString() : "-"}</td>
                      <td className="actions" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="btn-icon" title="Edit" onClick={() => openEdit(p)}>
                          <MdEdit />
                        </button>
                        <button
                          className="btn-icon danger"
                          title="Delete"
                          onClick={() => askDelete(p._id)}
                        >
                          <MdDelete />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {payments.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: "center" }}>
                        No payments yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <h3>Manual Payment Validation</h3>
            <form onSubmit={handleManualValidation} className="stacked-form" ref={dropdownRef}>
              {/* Customer search & select */}
              <div className="field">
                <input
                  type="text"
                  placeholder="Search customer by name or account number"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  autoComplete="off"
                />
                {loadingSearch && <div className="help-text">Searching…</div>}
                {searchError && <div className="error-text">{searchError}</div>}

                {customerResults.length > 0 && (
                  <ul className="search-dropdown">
                    {customerResults.map((c) => (
                      <li
                        key={c._id}
                        onClick={() => {
                          setManualPayment((prev) => ({
                            ...prev,
                            customerId: c._id,
                            accountNumber: c.accountNumber || "",
                          }));
                          setSearchTerm(`${c.name} (${c.accountNumber})`);
                          setCustomerResults([]);
                        }}
                        title={`${c.name} — ${c.accountNumber}`}
                      >
                        {c.name} — {c.accountNumber}
                      </li>
                    ))}
                  </ul>
                )}

                {hasNoSearchResults && <div className="search-empty">No matching customers</div>}
              </div>

              {/* Transaction details */}
              <div className="field">
                <input
                  type="text"
                  placeholder="Transaction ID"
                  value={manualPayment.transactionId}
                  onChange={(e) => setManualPayment((p) => ({ ...p, transactionId: e.target.value }))}
                  required
                />
              </div>

              <div className="field">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Amount (KES) — optional (defaults to plan price)"
                  value={manualPayment.amount}
                  onChange={(e) => setManualPayment((p) => ({ ...p, amount: e.target.value }))}
                />
              </div>

              <div className="field">
                <select
                  value={manualPayment.method}
                  onChange={(e) => setManualPayment((p) => ({ ...p, method: e.target.value }))}
                >
                  <option value="">Select Method (default: Manual)</option>
                  <option value="manual">Manual (Cash/Bank)</option>
                  <option value="mpesa">M-Pesa</option>
                  <option value="stripe">Stripe</option>
                  <option value="paypal">PayPal</option>
                </select>
              </div>

              {/* Backdating & Extension */}
              <fieldset className="field">
                <legend>Backdate & Extension (optional)</legend>
                <label>Paid At (timestamp)
                  <input type="datetime-local" value={manualPayment.paidAt} onChange={(e) => setManualPayment((p) => ({ ...p, paidAt: e.target.value }))} />
                </label>
                <label>Backdate To (cycle anchor)
                  <input type="date" value={manualPayment.backdateTo} onChange={(e) => setManualPayment((p) => ({ ...p, backdateTo: e.target.value }))} />
                </label>
                <label>Expiry Override
                  <input type="date" value={manualPayment.expiryDate} onChange={(e) => setManualPayment((p) => ({ ...p, expiryDate: e.target.value }))} />
                </label>
                <label>Extend Days
                  <input type="number" min="0" step="1" value={manualPayment.extendDays} onChange={(e) => setManualPayment((p) => ({ ...p, extendDays: e.target.value }))} />
                </label>
                <p className="help-text">Use these to preserve a customer’s billing cycle (backdate) or add goodwill days.</p>
              </fieldset>

              <button type="submit" className="primary">
                <MdAdd className="inline-icon" /> Validate Payment
              </button>
            </form>
          </>
        )}

        {/* ===== Invoices Tab ===== */}
        {activeTab === "invoices" && (
          <>
            <h2>Invoices</h2>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Customer</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Due Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv._id}>
                      <td>{inv._id}</td>
                      <td>{inv.customerName || inv.customer?.name || "-"}</td>
                      <td>{inv.amount}</td>
                      <td>{inv.status}</td>
                      <td>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "-"}</td>
                      <td className="actions">
                        <button onClick={() => markInvoicePaid(inv._id)}>Mark Paid</button>
                        <button onClick={() => generateInvoice(inv._id)}>Generate</button>
                        <button onClick={() => viewInvoicePDF(inv._id)}>View PDF</button>
                      </td>
                    </tr>
                  ))}
                  {invoices.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center" }}>
                        No invoices yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ===== Edit Drawer ===== */}
        {editOpen && editPayment && (
          <div className="drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && setEditOpen(false)}>
            <div className="drawer">
              <button className="drawer-close" onClick={() => setEditOpen(false)} aria-label="Close">
                <MdClose size={18} />
              </button>
              <h3>Edit Payment</h3>
              <form onSubmit={saveEdit} className="stacked-form">
                <div className="field">
                  <label>Transaction ID</label>
                  <input
                    type="text"
                    value={editPayment.transactionId}
                    onChange={(e) => setEditPayment((p) => ({ ...p, transactionId: e.target.value }))}
                    required
                  />
                </div>
                <div className="field">
                  <label>Amount (KES)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editPayment.amount}
                    onChange={(e) => setEditPayment((p) => ({ ...p, amount: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label>Method</label>
                  <select
                    value={editPayment.method}
                    onChange={(e) => setEditPayment((p) => ({ ...p, method: e.target.value }))}
                  >
                    <option value="manual">Manual</option>
                    <option value="mpesa">M-Pesa</option>
                    <option value="stripe">Stripe</option>
                    <option value="paypal">PayPal</option>
                  </select>
                </div>
                <div className="field">
                  <label>Status</label>
                  <select
                    value={editPayment.status}
                    onChange={(e) => setEditPayment((p) => ({ ...p, status: e.target.value }))}
                  >
                    <option value="Validated">Validated</option>
                    <option value="Pending">Pending</option>
                    <option value="Failed">Failed</option>
                    <option value="Refunded">Refunded</option>
                    <option value="Reversed">Reversed</option>
                  </select>
                </div>
                <div className="field">
                  <label>Notes</label>
                  <textarea
                    rows={4}
                    value={editPayment.notes}
                    onChange={(e) => setEditPayment((p) => ({ ...p, notes: e.target.value }))}
                    placeholder="Optional notes / reason for edit"
                  />
                </div>

                {/* Backdating in edit */}
                <fieldset className="field">
                  <legend>Backdate & Extension</legend>
                  <label>Validated At
                    <input type="datetime-local" value={editPayment.validatedAt} onChange={(e) => setEditPayment((p) => ({ ...p, validatedAt: e.target.value }))} />
                  </label>
                  <label>Backdate To
                    <input type="date" value={editPayment.backdateTo} onChange={(e) => setEditPayment((p) => ({ ...p, backdateTo: e.target.value }))} />
                  </label>
                  <label>Expiry Override
                    <input type="date" value={editPayment.expiryDate} onChange={(e) => setEditPayment((p) => ({ ...p, expiryDate: e.target.value }))} />
                  </label>
                  <label>Extend Days
                    <input type="number" min="0" step="1" value={editPayment.extendDays} onChange={(e) => setEditPayment((p) => ({ ...p, extendDays: e.target.value }))} />
                  </label>
                </fieldset>

                <div className="drawer-actions">
                  <button type="button" className="secondary" onClick={() => setEditOpen(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="primary" disabled={editSaving}>
                    {editSaving ? "Saving…" : "Save Changes"}
                  </button>
                </div>
            </form>
            </div>
          </div>
        )}

        {/* ===== Confirm Delete ===== */}
        {confirm.open && (
          <div className="confirm-overlay" onMouseDown={(e) => e.target === e.currentTarget && setConfirm({ open: false, id: null, loading: false, message: "" })}>
            <div className="confirm-dialog">
              <h4>Delete Payment?</h4>
              <p>{confirm.message}</p>
              <div className="confirm-actions">
                <button className="secondary" onClick={() => setConfirm({ open: false, id: null, loading: false, message: "" })} disabled={confirm.loading}>
                  Cancel
                </button>
                <button className="danger" onClick={doDelete} disabled={confirm.loading}>
                  {confirm.loading ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
