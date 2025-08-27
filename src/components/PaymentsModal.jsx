import React, { useState, useEffect } from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd } from "react-icons/md";
import axios from "axios";

export default function PaymentsModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState("payments"); // "payments" | "invoices"
  const [payments, setPayments] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [customerResults, setCustomerResults] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [manualPayment, setManualPayment] = useState({
    customer: null,
    accountNumber: "",
    transactionId: "",
    amount: "",
    method: "",
  });

  // Fetch payments and invoices when modal opens
  useEffect(() => {
    if (!isOpen) return;
    fetchPayments();
    fetchInvoices();
  }, [isOpen]);

  // ===== Fetch Payments =====
  const fetchPayments = async () => {
    try {
      const res = await axios.get("https://isp-billing-uq58.onrender.com/api/payments");
      setPayments(res.data);
    } catch (err) {
      console.error("Failed to load payments:", err);
    }
  };

  // ===== Fetch Invoices =====
  const fetchInvoices = async () => {
    try {
      const res = await axios.get("https://isp-billing-uq58.onrender.com/api/invoices");
      setInvoices(res.data);
    } catch (err) {
      console.error("Failed to load invoices:", err);
    }
  };

  // ===== Search Customers for Manual Validation =====
  const searchCustomers = async (query) => {
    if (!query.trim()) {
      setCustomerResults([]);
      return;
    }
    setLoadingSearch(true);
    try {
      const res = await axios.get(`https://isp-billing-uq58.onrender.com/api/payments/search?query=${query}`);
      setCustomerResults(res.data);
    } catch (err) {
      console.error("Customer search failed:", err);
    } finally {
      setLoadingSearch(false);
    }
  };

  // Debounce search input
  useEffect(() => {
    const delay = setTimeout(() => {
      if (searchTerm.trim()) searchCustomers(searchTerm);
    }, 500);
    return () => clearTimeout(delay);
  }, [searchTerm]);

  // ===== Manual Validation Submission =====
  const handleManualValidation = async (e) => {
    e.preventDefault();
    if (!manualPayment.customer) {
      alert("Please select a customer before validating.");
      return;
    }
    try {
      await axios.post("https://isp-billing-uq58.onrender.com/api/payments/manual", manualPayment);
      alert("Payment validated successfully!");
      setManualPayment({
        customer: null,
        accountNumber: "",
        transactionId: "",
        amount: "",
        method: "",
      });
      setSearchTerm("");
      fetchPayments();
    } catch (err) {
      console.error("Validation failed:", err);
      alert("Error validating payment");
    }
  };

  // ===== Invoice Actions =====
  const markInvoicePaid = async (id) => {
    try {
      await axios.put(`https://isp-billing-uq58.onrender.com/api/invoices/${id}/pay`);
      alert("Invoice marked as paid!");
      fetchInvoices();
    } catch (err) {
      console.error("Failed to mark paid:", err);
      alert("Error marking invoice as paid");
    }
  };

  const generateInvoice = async (id) => {
    try {
      await axios.post(`https://isp-billing-uq58.onrender.com/api/invoices/${id}/generate`);
      alert("Invoice generated successfully!");
      fetchInvoices();
    } catch (err) {
      console.error("Failed to generate invoice:", err);
      alert("Error generating invoice");
    }
  };

  const viewInvoicePDF = async (id) => {
    try {
      const res = await axios.get(`https://isp-billing-uq58.onrender.com/api/invoices/${id}/pdf`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      window.open(url, "_blank");
    } catch (err) {
      console.error("Failed to fetch PDF:", err);
      alert("Error fetching invoice PDF");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content large">
        <span className="close" onClick={onClose}>
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
                    <td>{p.customerName || p.customer?.name}</td>
                    <td>{p.amount}</td>
                    <td>{p.method}</td>
                    <td>{p.status}</td>
                    <td>{new Date(p.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3>Manual Payment Validation</h3>
            <form onSubmit={handleManualValidation}>
              <input
                type="text"
                placeholder="Search Customer by name or account no."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {loadingSearch && <p>Searching...</p>}
              {customerResults.length > 0 && (
                <ul className="search-dropdown">
                  {customerResults.map((c) => (
                    <li
                      key={c._id}
                      onClick={() => {
                        setManualPayment({
                          ...manualPayment,
                          customer: c._id,
                          accountNumber: c.accountNumber,
                        });
                        setSearchTerm(`${c.name} (${c.accountNumber})`);
                        setCustomerResults([]);
                      }}
                    >
                      {c.name} — {c.accountNumber}
                    </li>
                  ))}
                </ul>
              )}

              <input
                type="text"
                placeholder="Transaction ID"
                value={manualPayment.transactionId}
                onChange={(e) =>
                  setManualPayment({ ...manualPayment, transactionId: e.target.value })
                }
                required
              />
              <input
                type="number"
                placeholder="Amount (KES)"
                value={manualPayment.amount}
                onChange={(e) =>
                  setManualPayment({ ...manualPayment, amount: e.target.value })
                }
                required
              />
              <select
                value={manualPayment.method}
                onChange={(e) =>
                  setManualPayment({ ...manualPayment, method: e.target.value })
                }
                required
              >
                <option value="">Select Method</option>
                <option value="mpesa">M-Pesa</option>
                <option value="manual">Manual (Cash/Bank)</option>
                <option value="stripe">Stripe</option>
                <option value="PayPal">PayPal</option>
              </select>
              <button type="submit">
                <MdAdd className="inline-icon" /> Validate Payment
              </button>
            </form>
          </>
        )}

        {/* ===== Invoices Tab ===== */}
        {activeTab === "invoices" && (
          <>
            <h2>Invoices</h2>
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
                    <td>{inv.customerName || inv.customer?.name}</td>
                    <td>{inv.amount}</td>
                    <td>{inv.status}</td>
                    <td>{new Date(inv.dueDate).toLocaleDateString()}</td>
                    <td>
                      <button onClick={() => markInvoicePaid(inv._id)}>Mark Paid</button>
                      <button onClick={() => generateInvoice(inv._id)}>Generate</button>
                      <button onClick={() => viewInvoicePDF(inv._id)}>View PDF</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
