// src/components/PaymentsModal.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd } from "react-icons/md";
import { api } from "../lib/apiClient"; // ✅ use shared axios with auth/x-isp-id

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
  });

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
      // backend route expected: GET /api/customers/search?query=...
      const { data } = await api.get(`/customers/search`, {
        params: { query },
      });
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
      // Preferred route: POST /api/payments/manual
      // Body contains: customerId (required), accountNumber (optional), transactionId, amount (optional), method
      await api.post(`/payments/manual`, {
        customerId: manualPayment.customerId,
        accountNumber: manualPayment.accountNumber,
        transactionId: manualPayment.transactionId,
        amount:
          manualPayment.amount !== ""
            ? Number(manualPayment.amount)
            : undefined, // backend can default to plan price
        method: manualPayment.method || "manual",
        validatedBy: "Admin Panel",
        notes: "Manual validation from PaymentsModal",
      });

      alert("Payment validated successfully!");

      // reset
      setManualPayment({
        customerId: null,
        accountNumber: "",
        transactionId: "",
        amount: "",
        method: "",
      });
      setSearchTerm("");
      setCustomerResults([]);

      // refresh lists
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
      const res = await api.get(`/invoices/${id}/pdf`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      window.open(url, "_blank");
    } catch (err) {
      console.error("Failed to fetch PDF:", err);
      alert(getErrMsg(err, "Error fetching invoice PDF"));
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
          <button
            className={activeTab === "payments" ? "active" : ""}
            onClick={() => setActiveTab("payments")}
          >
            Payments
          </button>
          <button
            className={activeTab === "invoices" ? "active" : ""}
            onClick={() => setActiveTab("invoices")}
          >
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
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p._id}>
                      <td>{p._id}</td>
                      <td>{p.customerName || p.customer?.name || "-"}</td>
                      <td>{p.amount}</td>
                      <td>{p.method}</td>
                      <td>{p.status}</td>
                      <td>
                        {p.createdAt
                          ? new Date(p.createdAt).toLocaleString()
                          : "-"}
                      </td>
                    </tr>
                  ))}
                  {payments.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center" }}>
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

                {hasNoSearchResults && (
                  <div className="search-empty">No matching customers</div>
                )}
              </div>

              {/* Transaction details */}
              <div className="field">
                <input
                  type="text"
                  placeholder="Transaction ID"
                  value={manualPayment.transactionId}
                  onChange={(e) =>
                    setManualPayment((p) => ({
                      ...p,
                      transactionId: e.target.value,
                    }))
                  }
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
                  onChange={(e) =>
                    setManualPayment((p) => ({ ...p, amount: e.target.value }))
                  }
                />
              </div>

              <div className="field">
                <select
                  value={manualPayment.method}
                  onChange={(e) =>
                    setManualPayment((p) => ({ ...p, method: e.target.value }))
                  }
                >
                  <option value="">Select Method (default: Manual)</option>
                  <option value="manual">Manual (Cash/Bank)</option>
                  <option value="mpesa">M-Pesa</option>
                  <option value="stripe">Stripe</option>
                  <option value="paypal">PayPal</option>
                </select>
              </div>

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
                      <td>
                        {inv.dueDate
                          ? new Date(inv.dueDate).toLocaleDateString()
                          : "-"}
                      </td>
                      <td className="actions">
                        <button onClick={() => markInvoicePaid(inv._id)}>
                          Mark Paid
                        </button>
                        <button onClick={() => generateInvoice(inv._id)}>
                          Generate
                        </button>
                        <button onClick={() => viewInvoicePDF(inv._id)}>
                          View PDF
                        </button>
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
      </div>
    </div>
  );
}
