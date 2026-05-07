import "./PaymentsModal.css";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd, MdEdit, MdDelete, MdClose } from "react-icons/md";
import { api } from "../lib/apiClient";
import { exportRows } from "../lib/exporters";
import useDragResize from "../hooks/useDragResize";
import { useAuth } from "../context/AuthContext";

const DEFAULT_GATEWAY_FILTERS = {
  provider: "",
  kind: "",
  eventStatus: "",
  paymentId: "",
  limit: "50",
};

const RETRYABLE_GATEWAY_STATUSES = new Set(["unmatched", "failed", "rejected"]);

function getGatewayResolutionTargetType(event) {
  const provider = String(event?.provider || "").toLowerCase();
  const kind = String(event?.kind || "").toLowerCase();
  if ((provider === "mpesa" && kind === "stk-callback") || (provider === "stripe" && kind === "webhook")) {
    return "payment";
  }
  if (provider === "mpesa" && kind === "c2b-confirmation") {
    return "customer";
  }
  return null;
}

function formatTokenLabel(value) {
  return String(value || "")
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getGatewayStatusTone(status) {
  switch (String(status || "").toLowerCase()) {
    case "processed":
      return "success";
    case "unmatched":
      return "warning";
    case "failed":
    case "rejected":
      return "danger";
    case "processing":
    case "received":
      return "info";
    default:
      return "neutral";
  }
}

function formatJsonBlock(value) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value ?? "");
  }
}

export default function PaymentsModal({ isOpen, onClose }) {
  const { role } = useAuth();
  const canOperateGatewayEvents =
    role === "owner" || role === "admin" || role === "platform-admin";
  const canViewFinance =
    role === "owner" || role === "admin" || role === "platform-admin";
  const [activeTab, setActiveTab] = useState("payments"); // "payments" | "invoices" | "finance" | "reconciliation"
  const [payments, setPayments] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [plans, setPlans] = useState([]);
  const [financeSummary, setFinanceSummary] = useState(null);
  const [financeAging, setFinanceAging] = useState({ buckets: {}, rows: [] });
  const [financeCredits, setFinanceCredits] = useState([]);
  const [financeLedger, setFinanceLedger] = useState([]);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [financeError, setFinanceError] = useState("");
  const [runningPaymentActionId, setRunningPaymentActionId] = useState(null);
  const [selectedPaymentAuditId, setSelectedPaymentAuditId] = useState(null);
  const [selectedPaymentAudit, setSelectedPaymentAudit] = useState(null);
  const [paymentAuditLoading, setPaymentAuditLoading] = useState(false);
  const [paymentAuditError, setPaymentAuditError] = useState("");
  const [selectedInvoiceAuditId, setSelectedInvoiceAuditId] = useState(null);
  const [selectedInvoiceAudit, setSelectedInvoiceAudit] = useState(null);
  const [invoiceAuditLoading, setInvoiceAuditLoading] = useState(false);
  const [invoiceAuditError, setInvoiceAuditError] = useState("");
  const [gatewayEvents, setGatewayEvents] = useState([]);
  const [gatewayLoading, setGatewayLoading] = useState(false);
  const [gatewayError, setGatewayError] = useState("");
  const [gatewayFilters, setGatewayFilters] = useState(DEFAULT_GATEWAY_FILTERS);
  const [selectedGatewayEventId, setSelectedGatewayEventId] = useState(null);
  const [selectedGatewayEvent, setSelectedGatewayEvent] = useState(null);
  const [gatewayDetailLoading, setGatewayDetailLoading] = useState(false);
  const [gatewayDetailError, setGatewayDetailError] = useState("");
  const [gatewayActionMessage, setGatewayActionMessage] = useState(null);
  const [retryingGatewayEventId, setRetryingGatewayEventId] = useState(null);
  const [gatewayResolutionQuery, setGatewayResolutionQuery] = useState("");
  const [gatewayResolutionResults, setGatewayResolutionResults] = useState([]);
  const [gatewayResolutionLoading, setGatewayResolutionLoading] = useState(false);
  const [gatewayResolutionError, setGatewayResolutionError] = useState("");
  const [gatewayResolutionNote, setGatewayResolutionNote] = useState("");
  const [resolvingGatewayEventId, setResolvingGatewayEventId] = useState(null);

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
    paidAt: "",
    backdateTo: "",
    expiryDate: "",
    extendDays: "",
  });

  // ------- Backdate / Goodwill state -------
  const [adjustSearchTerm, setAdjustSearchTerm] = useState("");
  const [adjustResults, setAdjustResults] = useState([]);
  const [adjustLoading, setAdjustLoading] = useState(false);
  const [adjustSearchError, setAdjustSearchError] = useState("");
  const [adjustForm, setAdjustForm] = useState({
    customerId: null,
    accountNumber: "",
    customerName: "",
    backdateTo: "",
    extendDays: "",
    notes: "",
  });
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [adjustToast, setAdjustToast] = useState(null);
  const toastTimerRef = useRef(null);

  const [invoiceSearchTerm, setInvoiceSearchTerm] = useState("");
  const [invoiceResults, setInvoiceResults] = useState([]);
  const [invoiceSearchLoading, setInvoiceSearchLoading] = useState(false);
  const [invoiceSearchError, setInvoiceSearchError] = useState("");
  const [invoiceSaving, setInvoiceSaving] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({
    customerId: null,
    customerName: "",
    accountNumber: "",
    planId: "",
    amount: "",
    dueDate: "",
    servicePeriodStart: "",
    servicePeriodEnd: "",
    billingReason: "manual",
  });

  // ------- Edit/Delete state -------
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editPayment, setEditPayment] = useState(null);
  const [confirm, setConfirm] = useState({ open: false, id: null, loading: false, message: "" });

  const manualDropdownRef = useRef(null);
  const adjustDropdownRef = useRef(null);
  const invoiceDropdownRef = useRef(null);

  const containerRef = useRef(null);
  const dragHandleRef = useRef(null);
  const { getResizeHandleProps, isDraggingEnabled } = useDragResize({
    isOpen,
    containerRef,
    handleRef: dragHandleRef,
    minWidth: 720,
    minHeight: 520,
    defaultSize: { width: 980, height: 680 },
  });
  const resizeHandles = isDraggingEnabled ? ["n", "s", "e", "w", "ne", "nw", "se", "sw"] : [];

  // fetch on open
  useEffect(() => {
    if (!isOpen) return;
    fetchPayments();
    fetchInvoices();
    fetchPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // close dropdowns on outside click
  useEffect(() => {
    function onDocClick(e) {
      if (manualDropdownRef.current && !manualDropdownRef.current.contains(e.target)) {
        setCustomerResults([]);
      }
      if (adjustDropdownRef.current && !adjustDropdownRef.current.contains(e.target)) {
        setAdjustResults([]);
      }
      if (invoiceDropdownRef.current && !invoiceDropdownRef.current.contains(e.target)) {
        setInvoiceResults([]);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Defensive inline container styles so CSS flex layout assumptions always hold
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!isOpen) {
      // clear defensive inline styles when modal closed
      el.style.display = "";
      el.style.flexDirection = "";
      el.style.boxSizing = "";
      return;
    }
    // ensure modal container behaves like a flex column (so inner .table-wrapper can flex/scroll)
    el.style.display = "flex";
    el.style.flexDirection = "column";
    el.style.boxSizing = "border-box";
    // note: hook may still write inline width/height/position; this complements it.
  }, [isOpen]);

  // ---------- API helpers ----------
  const getErrMsg = (err, fallback = "Request failed") =>
    err?.response?.data?.error ||
    err?.response?.data?.message ||
    err?.message ||
    fallback;

  const formatDateTime = (value) => {
    if (!value) return "";
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const formatDateOnly = (value) => {
    if (!value) return "";
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return "";
    return d.toLocaleDateString();
  };

  const formatCurrency = (value, currency = "KES") => {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "-";
    return `${amount.toFixed(2)} ${currency || "KES"}`;
  };

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

  const fetchPlans = async () => {
    try {
      const { data } = await api.get(`/plans`);
      setPlans(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load plans:", err);
      setPlans([]);
    }
  };

  const openPaymentAudit = async (paymentId) => {
    if (!paymentId) return;
    setSelectedPaymentAuditId(paymentId);
    setPaymentAuditLoading(true);
    setPaymentAuditError("");
    try {
      const { data } = await api.get(`/payments/${paymentId}`);
      setSelectedPaymentAudit(data || null);
    } catch (err) {
      console.error("Failed to load payment detail:", err);
      setSelectedPaymentAudit(null);
      setPaymentAuditError(getErrMsg(err, "Failed to load payment detail"));
    } finally {
      setPaymentAuditLoading(false);
    }
  };

  const openInvoiceAudit = async (invoiceId) => {
    if (!invoiceId) return;
    setSelectedInvoiceAuditId(invoiceId);
    setInvoiceAuditLoading(true);
    setInvoiceAuditError("");
    try {
      const { data } = await api.get(`/invoices/${invoiceId}`);
      setSelectedInvoiceAudit(data || null);
    } catch (err) {
      console.error("Failed to load invoice detail:", err);
      setSelectedInvoiceAudit(null);
      setInvoiceAuditError(getErrMsg(err, "Failed to load invoice detail"));
    } finally {
      setInvoiceAuditLoading(false);
    }
  };

  const refreshSelectedAudits = async () => {
    const requests = [];
    if (selectedPaymentAuditId) {
      requests.push(openPaymentAudit(selectedPaymentAuditId));
    }
    if (selectedInvoiceAuditId) {
      requests.push(openInvoiceAudit(selectedInvoiceAuditId));
    }
    if (requests.length > 0) {
      await Promise.all(requests);
    }
  };

  const fetchFinanceReports = async () => {
    if (!canViewFinance) return;
    setFinanceLoading(true);
    setFinanceError("");
    try {
      const [summaryRes, agingRes, creditsRes, ledgerRes] = await Promise.all([
        api.get(`/finance/summary`),
        api.get(`/finance/invoice-aging`),
        api.get(`/finance/credits`, { params: { onlyOpen: true, limit: 20 } }),
        api.get(`/finance/ledger`, { params: { limit: 20 } }),
      ]);
      setFinanceSummary(summaryRes.data || null);
      setFinanceAging(agingRes.data || { buckets: {}, rows: [] });
      setFinanceCredits(Array.isArray(creditsRes.data) ? creditsRes.data : []);
      setFinanceLedger(Array.isArray(ledgerRes.data) ? ledgerRes.data : []);
    } catch (err) {
      console.error("Failed to load finance reports:", err);
      setFinanceError(getErrMsg(err, "Failed to load finance reports"));
      setFinanceSummary(null);
      setFinanceAging({ buckets: {}, rows: [] });
      setFinanceCredits([]);
      setFinanceLedger([]);
    } finally {
      setFinanceLoading(false);
    }
  };

  const fetchGatewayEvents = async (filters = gatewayFilters) => {
    setGatewayLoading(true);
    setGatewayError("");
    try {
      const params = {
        limit: filters.limit || DEFAULT_GATEWAY_FILTERS.limit,
      };
      if (filters.provider) params.provider = filters.provider;
      if (filters.kind) params.kind = filters.kind;
      if (filters.eventStatus) params.eventStatus = filters.eventStatus;
      if (filters.paymentId.trim()) params.paymentId = filters.paymentId.trim();

      const { data } = await api.get(`/payments/events`, { params });
      const events = Array.isArray(data) ? data : [];
      setGatewayEvents(events);
      setSelectedGatewayEventId((current) =>
        current && events.some((event) => event._id === current) ? current : null
      );
      if (selectedGatewayEventId && !events.some((event) => event._id === selectedGatewayEventId)) {
        setSelectedGatewayEvent(null);
        setGatewayDetailError("");
      }
    } catch (err) {
      console.error("Failed to load payment gateway events:", err);
      setGatewayError(getErrMsg(err, "Failed to load payment gateway events"));
      setGatewayEvents([]);
      setSelectedGatewayEventId(null);
      setSelectedGatewayEvent(null);
      setGatewayDetailError("");
    } finally {
      setGatewayLoading(false);
    }
  };

  const openGatewayEvent = async (eventId) => {
    setSelectedGatewayEventId(eventId);
    setGatewayDetailLoading(true);
    setGatewayDetailError("");
    try {
      const { data } = await api.get(`/payments/events/${eventId}`);
      setSelectedGatewayEvent(data || null);
    } catch (err) {
      console.error("Failed to load payment gateway event detail:", err);
      setSelectedGatewayEvent(null);
      setGatewayDetailError(getErrMsg(err, "Failed to load gateway event detail"));
    } finally {
      setGatewayDetailLoading(false);
    }
  };

  const handleExportPayments = async () => {
    if (!Array.isArray(payments) || payments.length === 0) return;
    const headers = [
      "Payment ID",
      "Account #",
      "Customer",
      "Plan",
      "Amount (KES)",
      "Method",
      "Status",
      "Validated At",
      "Created At",
      "Expiry Date",
    ];
    const rows = payments.map((p) => ({
      "Payment ID": p._id || "",
      "Account #": p.accountNumber || p.customer?.accountNumber || "",
      Customer: p.customerName || p.customer?.name || "",
      Plan: p.plan?.name || "",
      "Amount (KES)": Number.isFinite(Number(p.amount)) ? Number(p.amount).toFixed(2) : p.amount || "",
      Method: p.method || "",
      Status: p.status || "",
      "Validated At": formatDateTime(p.validatedAt),
      "Created At": formatDateTime(p.createdAt),
      "Expiry Date": formatDateTime(p.expiryDate),
    }));
    try {
      await exportRows({
        rows,
        headers,
        filename: `payments-${new Date().toISOString().slice(0, 10)}`,
        sheetName: "Payments",
      });
    } catch (err) {
      console.error("Payments export failed:", err);
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

  const searchAdjustCustomers = async (q) => {
    const query = q.trim();
    if (!query) {
      setAdjustResults([]);
      setAdjustSearchError("");
      return;
    }
    setAdjustLoading(true);
    setAdjustSearchError("");
    try {
      const { data } = await api.get(`/customers/search`, { params: { query } });
      setAdjustResults(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Adjust customer search failed:", err);
      setAdjustSearchError("Search failed");
      setAdjustResults([]);
    } finally {
      setAdjustLoading(false);
    }
  };

  useEffect(() => {
    const id = setTimeout(() => searchAdjustCustomers(adjustSearchTerm), 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjustSearchTerm]);

  const searchInvoiceCustomers = async (q) => {
    const query = q.trim();
    if (!query) {
      setInvoiceResults([]);
      setInvoiceSearchError("");
      return;
    }
    setInvoiceSearchLoading(true);
    setInvoiceSearchError("");
    try {
      const { data } = await api.get(`/customers/search`, { params: { query } });
      setInvoiceResults(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Invoice customer search failed:", err);
      setInvoiceSearchError("Search failed");
      setInvoiceResults([]);
    } finally {
      setInvoiceSearchLoading(false);
    }
  };

  useEffect(() => {
    const id = setTimeout(() => searchInvoiceCustomers(invoiceSearchTerm), 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceSearchTerm]);

  useEffect(() => {
    if (!isOpen || activeTab !== "reconciliation") return;
    fetchGatewayEvents(gatewayFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab]);

  useEffect(() => {
    if (!isOpen || activeTab !== "finance" || !canViewFinance) return;
    fetchFinanceReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab, canViewFinance]);

  useEffect(() => {
    if (!adjustToast) return () => {};
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setAdjustToast(null), 2500);
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, [adjustToast]);

  useEffect(() => {
    if (!gatewayActionMessage) return () => {};
    const timer = setTimeout(() => setGatewayActionMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [gatewayActionMessage]);

  const gatewayResolutionType = useMemo(
    () => getGatewayResolutionTargetType(selectedGatewayEvent),
    [selectedGatewayEvent]
  );

  useEffect(() => {
    if (!selectedGatewayEvent) {
      setGatewayResolutionQuery("");
      setGatewayResolutionResults([]);
      setGatewayResolutionError("");
      setGatewayResolutionNote("");
      return;
    }
    const seedQuery = selectedGatewayEvent.accountNumber || selectedGatewayEvent.phoneNumber || "";
    setGatewayResolutionQuery(seedQuery);
    setGatewayResolutionResults([]);
    setGatewayResolutionError("");
    setGatewayResolutionNote("");
  }, [selectedGatewayEvent, gatewayResolutionType]);

  useEffect(() => {
    if (!selectedGatewayEvent || !gatewayResolutionType || !canOperateGatewayEvents) return () => {};
    const query = gatewayResolutionQuery.trim();
    if (!query) {
      setGatewayResolutionResults([]);
      setGatewayResolutionError("");
      return () => {};
    }

    const timer = setTimeout(async () => {
      setGatewayResolutionLoading(true);
      setGatewayResolutionError("");
      try {
        const endpoint = gatewayResolutionType === "payment" ? "/payments/search" : "/customers/search";
        const { data } = await api.get(endpoint, { params: { query } });
        let results = Array.isArray(data) ? data : [];
        if (gatewayResolutionType === "payment") {
          const expectedMethod = String(selectedGatewayEvent.provider || "").toLowerCase() === "stripe"
            ? "stripe"
            : "mpesa";
          results = results.filter((payment) =>
            String(payment.method || "").toLowerCase() === expectedMethod &&
            (payment.status === "Pending" || payment.status === "Failed")
          );
        }
        setGatewayResolutionResults(results);
      } catch (err) {
        console.error("Gateway resolution search failed:", err);
        setGatewayResolutionResults([]);
        setGatewayResolutionError(getErrMsg(err, "Search failed"));
      } finally {
        setGatewayResolutionLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [selectedGatewayEvent, gatewayResolutionType, gatewayResolutionQuery, canOperateGatewayEvents]);

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
      await fetchPayments();
      await fetchInvoices();
      if (canViewFinance) await fetchFinanceReports();
      await refreshSelectedAudits();
    } catch (err) {
      console.error("Validation failed:", err);
      alert(getErrMsg(err, "Error validating payment"));
    }
  };

  const handleAdjustment = async (e) => {
    e.preventDefault();
    if (!adjustForm.customerId) {
      setAdjustToast({ type: "error", message: "Select a customer to adjust." });
      return;
    }

    const payload = {
      customerId: adjustForm.customerId,
      validatedBy: "Adjustment Tool",
    };

    const backdateTrim = adjustForm.backdateTo ? adjustForm.backdateTo.trim() : "";
    if (backdateTrim) {
      payload.backdateTo = backdateTrim;
    }

    const extendTrim = adjustForm.extendDays !== undefined && adjustForm.extendDays !== null
      ? String(adjustForm.extendDays).trim()
      : "";
    if (extendTrim) {
      const extendNumber = Number(extendTrim);
      if (!Number.isFinite(extendNumber)) {
        setAdjustToast({ type: "error", message: "Goodwill days must be a number." });
        return;
      }
      payload.extendDays = extendNumber;
    }

    if (!payload.backdateTo && payload.extendDays === undefined) {
      setAdjustToast({ type: "error", message: "Provide a backdate or goodwill days." });
      return;
    }

    if (adjustForm.notes.trim()) {
      payload.notes = adjustForm.notes.trim();
    }

    setAdjustSaving(true);
    try {
      const { data } = await api.post(`/payments/adjust`, payload);
      setAdjustToast({ type: "success", message: data?.message || "Adjustment applied." });
      setAdjustForm({
        customerId: null,
        accountNumber: "",
        customerName: "",
        backdateTo: "",
        extendDays: "",
        notes: "",
      });
      setAdjustSearchTerm("");
      setAdjustResults([]);
      await fetchPayments();
      if (canViewFinance) await fetchFinanceReports();
      await refreshSelectedAudits();
    } catch (err) {
      setAdjustToast({ type: "error", message: getErrMsg(err, "Adjustment failed") });
    } finally {
      setAdjustSaving(false);
    }
  };

  const markInvoicePaid = async (id) => {
    try {
      await api.put(`/invoices/${id}/pay`);
      alert("Invoice marked as paid!");
      await fetchPayments();
      await fetchInvoices();
      if (canViewFinance) await fetchFinanceReports();
      await refreshSelectedAudits();
    } catch (err) {
      console.error("Failed to mark paid:", err);
      alert(getErrMsg(err, "Error marking invoice as paid"));
    }
  };

  const generateInvoice = async (id) => {
    try {
      await api.post(`/invoices/${id}/generate`);
      alert("Invoice generated successfully!");
      await fetchInvoices();
      if (canViewFinance) await fetchFinanceReports();
      await refreshSelectedAudits();
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
      await api.put(`/payments/${editPayment._id}`, {
        transactionId: String(editPayment.transactionId || "").trim(),
        amount: editPayment.amount === "" ? undefined : Number(editPayment.amount),
        method: editPayment.method || "manual",
        notes: editPayment.notes || undefined,
        status: editPayment.status || undefined,
        validatedAt: editPayment.validatedAt ? new Date(editPayment.validatedAt).toISOString() : undefined,
        backdateTo: editPayment.backdateTo || undefined,
        expiryDate: editPayment.expiryDate || undefined,
        extendDays: editPayment.extendDays !== "" ? Number(editPayment.extendDays) : undefined,
      });

      await fetchPayments();
      await fetchInvoices();
      if (canViewFinance) {
        await fetchFinanceReports();
      }
      await refreshSelectedAudits();
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
      await api.delete(`/payments/${confirm.id}`);
      setPayments((list) => list.filter((p) => p._id !== confirm.id));
      if (selectedPaymentAuditId === confirm.id) {
        setSelectedPaymentAuditId(null);
        setSelectedPaymentAudit(null);
        setPaymentAuditError("");
      }
      setConfirm({ open: false, id: null, loading: false, message: "" });
      await fetchInvoices();
      if (canViewFinance) await fetchFinanceReports();
      await refreshSelectedAudits();
    } catch (err) {
      alert(getErrMsg(err, "Failed to delete payment"));
      setConfirm((s) => ({ ...s, loading: false }));
    }
  };

  const runPaymentLifecycleAction = async (payment, action) => {
    if (!payment?._id) return;
    const actionLabel =
      action === "refund"
        ? "refund"
        : action === "reverse"
          ? "reverse"
          : "chargeback";
    const reason = window.prompt(`Reason for ${actionLabel}ing this payment?`, "");
    if (reason === null) return;
    setRunningPaymentActionId(`${action}:${payment._id}`);
    try {
      await api.post(`/payments/${payment._id}/${action}`, {
        reason: reason.trim() || undefined,
      });
      await fetchPayments();
      await fetchInvoices();
      if (canViewFinance) {
        await fetchFinanceReports();
      }
      await refreshSelectedAudits();
    } catch (err) {
      alert(getErrMsg(err, `Failed to ${actionLabel} payment`));
    } finally {
      setRunningPaymentActionId(null);
    }
  };

  const handleInvoicePlanChange = (planId) => {
    const selectedPlan = plans.find((plan) => plan._id === planId);
    setInvoiceForm((prev) => ({
      ...prev,
      planId,
      amount:
        selectedPlan && selectedPlan.price !== undefined && selectedPlan.price !== null
          ? String(selectedPlan.price)
          : prev.amount,
    }));
  };

  const submitInvoiceIssue = async (e) => {
    e.preventDefault();
    if (!invoiceForm.customerId) {
      alert("Select a customer before issuing an invoice.");
      return;
    }
    if (!invoiceForm.planId) {
      alert("Choose a plan for the invoice.");
      return;
    }

    setInvoiceSaving(true);
    try {
      await api.post(`/invoices/issue`, {
        customerId: invoiceForm.customerId,
        planId: invoiceForm.planId,
        amount: invoiceForm.amount === "" ? undefined : Number(invoiceForm.amount),
        dueDate: invoiceForm.dueDate || undefined,
        servicePeriodStart: invoiceForm.servicePeriodStart || undefined,
        servicePeriodEnd: invoiceForm.servicePeriodEnd || undefined,
        billingReason: invoiceForm.billingReason || "manual",
      });

      setInvoiceForm({
        customerId: null,
        customerName: "",
        accountNumber: "",
        planId: "",
        amount: "",
        dueDate: "",
        servicePeriodStart: "",
        servicePeriodEnd: "",
        billingReason: "manual",
      });
      setInvoiceSearchTerm("");
      setInvoiceResults([]);
      await fetchInvoices();
      if (canViewFinance) {
        await fetchFinanceReports();
      }
      await refreshSelectedAudits();
    } catch (err) {
      alert(getErrMsg(err, "Failed to issue invoice"));
    } finally {
      setInvoiceSaving(false);
    }
  };

  const hasNoSearchResults = useMemo(
    () => !loadingSearch && searchTerm.trim() && customerResults.length === 0,
    [loadingSearch, searchTerm, customerResults.length]
  );

  const hasNoInvoiceSearchResults = useMemo(
    () => !invoiceSearchLoading && invoiceSearchTerm.trim() && invoiceResults.length === 0,
    [invoiceSearchLoading, invoiceSearchTerm, invoiceResults.length]
  );

  const gatewayStatusSummary = useMemo(() => {
    const summary = {};
    gatewayEvents.forEach((event) => {
      const key = String(event.eventStatus || "unknown").toLowerCase();
      summary[key] = (summary[key] || 0) + 1;
    });
    return summary;
  }, [gatewayEvents]);

  const canRetryGatewayEvent =
    canOperateGatewayEvents &&
    selectedGatewayEvent &&
    RETRYABLE_GATEWAY_STATUSES.has(String(selectedGatewayEvent.eventStatus || "").toLowerCase());

  const canResolveGatewayEvent =
    canOperateGatewayEvents &&
    selectedGatewayEvent &&
    gatewayResolutionType &&
    RETRYABLE_GATEWAY_STATUSES.has(String(selectedGatewayEvent.eventStatus || "").toLowerCase());

  const gatewayResolutionPlaceholder = gatewayResolutionType === "payment"
    ? "Search pending or failed payments by customer or account number"
    : "Search customers by account number, name, phone, or email";

  const applyGatewayFilters = async (e) => {
    e.preventDefault();
    await fetchGatewayEvents(gatewayFilters);
  };

  const resetGatewayFilters = async () => {
    setGatewayFilters(DEFAULT_GATEWAY_FILTERS);
    await fetchGatewayEvents(DEFAULT_GATEWAY_FILTERS);
  };

  const retryGatewayEvent = async (eventId) => {
    if (!eventId || !canOperateGatewayEvents) return;
    setRetryingGatewayEventId(eventId);
    setGatewayActionMessage(null);
    setGatewayDetailError("");
    try {
      const { data } = await api.post(`/payments/events/${eventId}/retry`, {
        note: "Manual retry from payments reconciliation",
      });
      setGatewayActionMessage({
        type: "success",
        message: "Gateway event retried successfully.",
      });
      if (data?.event) {
        setSelectedGatewayEvent(data.event);
        setSelectedGatewayEventId(data.event._id || eventId);
      }
      await fetchGatewayEvents(gatewayFilters);
    } catch (err) {
      setGatewayActionMessage({
        type: "error",
        message: getErrMsg(err, "Gateway event retry failed"),
      });
    } finally {
      setRetryingGatewayEventId(null);
    }
  };

  const resolveGatewayEvent = async (target) => {
    if (!selectedGatewayEvent || !canResolveGatewayEvent || !target?._id) return;
    setResolvingGatewayEventId(target._id);
    setGatewayActionMessage(null);
    setGatewayDetailError("");
    try {
      const payload = {
        note: gatewayResolutionNote.trim() || undefined,
      };
      if (gatewayResolutionType === "payment") {
        payload.paymentId = target._id;
      } else if (gatewayResolutionType === "customer") {
        payload.customerId = target._id;
      }

      const { data } = await api.post(`/payments/events/${selectedGatewayEvent._id}/resolve`, payload);
      setGatewayActionMessage({
        type: "success",
        message: "Gateway event resolved successfully.",
      });
      if (data?.event) {
        setSelectedGatewayEvent(data.event);
        setSelectedGatewayEventId(data.event._id || selectedGatewayEvent._id);
      }
      setGatewayResolutionResults([]);
      await fetchGatewayEvents(gatewayFilters);
    } catch (err) {
      setGatewayActionMessage({
        type: "error",
        message: getErrMsg(err, "Gateway event resolution failed"),
      });
    } finally {
      setResolvingGatewayEventId(null);
    }
  };

  const renderAuditMetaItem = (label, value, options = {}) => (
    <div className="gateway-detail-item">
      <span className="gateway-detail-label">{label}</span>
      <span className={`gateway-detail-value${options.mono ? " mono-text" : ""}`}>
        {value !== undefined && value !== null && value !== "" ? value : "-"}
      </span>
    </div>
  );

  const renderPaymentAuditPanel = () => {
    if (paymentAuditError) {
      return (
        <div className="gateway-alert danger finance-audit-feedback">
          <strong>Payment detail failed:</strong> {paymentAuditError}
        </div>
      );
    }
    if (paymentAuditLoading) {
      return <div className="gateway-empty-panel">Loading payment detail...</div>;
    }
    if (!selectedPaymentAudit) {
      return (
        <div className="gateway-empty-panel compact">
          Select <strong>Inspect</strong> on any payment to review allocations, credits, and ledger movement.
        </div>
      );
    }

    const lifecycleSummary =
      selectedPaymentAudit.status === "Refunded"
        ? `Refunded ${formatDateTime(selectedPaymentAudit.refundedAt) || ""}`.trim()
        : selectedPaymentAudit.status === "Reversed"
          ? `Reversed ${formatDateTime(selectedPaymentAudit.reversedAt) || ""}`.trim()
          : selectedPaymentAudit.status === "Chargeback"
            ? `Chargeback ${formatDateTime(selectedPaymentAudit.chargedBackAt) || ""}`.trim()
            : "Active";

    return (
      <div className="gateway-event-detail finance-audit-panel">
        <div className="gateway-event-detail-header">
          <div>
            <h3>Payment Audit</h3>
            <p className="section-subtitle">
              Inspect how this payment flowed into invoices, credits, and the ledger.
            </p>
          </div>
          <div className="gateway-detail-actions">
            {selectedPaymentAudit.invoice?._id ? (
              <button
                type="button"
                className="secondary"
                onClick={async () => {
                  setActiveTab("invoices");
                  await openInvoiceAudit(selectedPaymentAudit.invoice._id);
                }}
              >
                Open Invoice
              </button>
            ) : null}
            <button
              type="button"
              className="secondary"
              onClick={() => openPaymentAudit(selectedPaymentAudit._id)}
            >
              Refresh
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setSelectedPaymentAuditId(null);
                setSelectedPaymentAudit(null);
                setPaymentAuditError("");
              }}
            >
              Close
            </button>
          </div>
        </div>

        <div className="gateway-detail-grid">
          {renderAuditMetaItem("Payment ID", selectedPaymentAudit._id, { mono: true })}
          {renderAuditMetaItem("Transaction ID", selectedPaymentAudit.transactionId, { mono: true })}
          {renderAuditMetaItem(
            "Customer",
            selectedPaymentAudit.customerName
              ? `${selectedPaymentAudit.customerName} (${selectedPaymentAudit.accountNumber || "N/A"})`
              : selectedPaymentAudit.accountNumber || "-"
          )}
          {renderAuditMetaItem("Plan", selectedPaymentAudit.planName || "-")}
          {renderAuditMetaItem(
            "Invoice",
            selectedPaymentAudit.invoiceNumber
              ? `${selectedPaymentAudit.invoiceNumber} (${selectedPaymentAudit.invoice?.status || "linked"})`
              : "Unlinked"
          )}
          {renderAuditMetaItem("Status", formatTokenLabel(selectedPaymentAudit.status))}
          {renderAuditMetaItem("Amount", formatCurrency(selectedPaymentAudit.amount, selectedPaymentAudit.currency))}
          {renderAuditMetaItem(
            "Allocated",
            formatCurrency(
              selectedPaymentAudit.totals?.allocatedAmount,
              selectedPaymentAudit.currency
            )
          )}
          {renderAuditMetaItem(
            "Unapplied",
            formatCurrency(
              selectedPaymentAudit.totals?.unappliedAmount,
              selectedPaymentAudit.currency
            )
          )}
          {renderAuditMetaItem(
            "Credits Issued",
            formatCurrency(
              selectedPaymentAudit.totals?.creditIssued,
              selectedPaymentAudit.currency
            )
          )}
          {renderAuditMetaItem("Validated", formatDateTime(selectedPaymentAudit.validatedAt) || "-")}
          {renderAuditMetaItem("Created", formatDateTime(selectedPaymentAudit.createdAt) || "-")}
          {renderAuditMetaItem("Expiry", formatDateTime(selectedPaymentAudit.expiryDate) || "-")}
          {renderAuditMetaItem("Finance Version", String(selectedPaymentAudit.financeVersion ?? 0))}
          {renderAuditMetaItem("Lifecycle", lifecycleSummary)}
        </div>

        <section className="finance-audit-section">
          <h4>Allocations</h4>
          <div className="finance-audit-table">
            <table className="data-table finance-detail-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Applied</th>
                  <th>Reversed</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {selectedPaymentAudit.allocations?.length ? (
                  selectedPaymentAudit.allocations.map((allocation) => (
                    <tr key={allocation._id}>
                      <td>
                        <strong>{allocation.invoice?.invoiceNumber || allocation.invoice?._id || "-"}</strong>
                        <div className="muted-inline">{formatTokenLabel(allocation.invoice?.status || "unknown")}</div>
                      </td>
                      <td>{formatCurrency(allocation.amount, allocation.currency)}</td>
                      <td>{formatTokenLabel(allocation.status)}</td>
                      <td>{formatDateTime(allocation.appliedAt) || "-"}</td>
                      <td>{formatDateTime(allocation.reversedAt) || "-"}</td>
                      <td className="actions" style={{ textAlign: "right" }}>
                        {allocation.invoice?._id ? (
                          <button
                            type="button"
                            className="secondary table-action"
                            onClick={async () => {
                              setActiveTab("invoices");
                              await openInvoiceAudit(allocation.invoice._id);
                            }}
                          >
                            Inspect Invoice
                          </button>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center" }}>
                      No invoice allocations recorded for this payment.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="finance-audit-section">
          <h4>Credit Notes</h4>
          <div className="finance-audit-table">
            <table className="data-table finance-detail-table">
              <thead>
                <tr>
                  <th>Credit Note</th>
                  <th>Amount</th>
                  <th>Remaining</th>
                  <th>Status</th>
                  <th>Reason</th>
                  <th>Issued</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {selectedPaymentAudit.creditNotes?.length ? (
                  selectedPaymentAudit.creditNotes.map((note) => (
                    <tr key={note._id}>
                      <td>{note.creditNoteNumber || note._id}</td>
                      <td>{formatCurrency(note.amount, note.currency)}</td>
                      <td>{formatCurrency(note.remainingAmount, note.currency)}</td>
                      <td>{formatTokenLabel(note.status)}</td>
                      <td>{note.reason || "-"}</td>
                      <td>{formatDateTime(note.issuedAt) || "-"}</td>
                      <td className="actions" style={{ textAlign: "right" }}>
                        {note.sourceInvoice?._id ? (
                          <button
                            type="button"
                            className="secondary table-action"
                            onClick={async () => {
                              setActiveTab("invoices");
                              await openInvoiceAudit(note.sourceInvoice._id);
                            }}
                          >
                            Source Invoice
                          </button>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center" }}>
                      No credit notes were issued from this payment.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="finance-audit-section">
          <h4>Ledger Entries</h4>
          <div className="finance-audit-table">
            <table className="data-table finance-detail-table">
              <thead>
                <tr>
                  <th>Effective</th>
                  <th>Account</th>
                  <th>Direction</th>
                  <th>Amount</th>
                  <th>Source</th>
                  <th>Batch</th>
                  <th>Reversed</th>
                </tr>
              </thead>
              <tbody>
                {selectedPaymentAudit.ledgerEntries?.length ? (
                  selectedPaymentAudit.ledgerEntries.map((entry) => (
                    <tr key={entry._id}>
                      <td>{formatDateTime(entry.effectiveAt) || "-"}</td>
                      <td>{entry.account || "-"}</td>
                      <td>{formatTokenLabel(entry.direction)}</td>
                      <td>{formatCurrency(entry.amount, entry.currency)}</td>
                      <td>{formatTokenLabel(entry.sourceType)}</td>
                      <td className="mono-text">{entry.batchId || "-"}</td>
                      <td>{formatDateTime(entry.reversedAt) || "-"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center" }}>
                      No ledger entries were linked to this payment.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  };

  const renderInvoiceAuditPanel = () => {
    if (invoiceAuditError) {
      return (
        <div className="gateway-alert danger finance-audit-feedback">
          <strong>Invoice detail failed:</strong> {invoiceAuditError}
        </div>
      );
    }
    if (invoiceAuditLoading) {
      return <div className="gateway-empty-panel">Loading invoice detail...</div>;
    }
    if (!selectedInvoiceAudit) {
      return (
        <div className="gateway-empty-panel compact">
          Select <strong>Inspect</strong> on any invoice to review its line items, allocations, credits, and ledger trail.
        </div>
      );
    }

    const servicePeriod =
      selectedInvoiceAudit.servicePeriodStart || selectedInvoiceAudit.servicePeriodEnd
        ? `${formatDateOnly(selectedInvoiceAudit.servicePeriodStart) || "?"} to ${formatDateOnly(selectedInvoiceAudit.servicePeriodEnd) || "?"}`
        : "Not set";

    return (
      <div className="gateway-event-detail finance-audit-panel">
        <div className="gateway-event-detail-header">
          <div>
            <h3>Invoice Audit</h3>
            <p className="section-subtitle">
              Review how this invoice was issued, settled, credited, and posted to the ledger.
            </p>
          </div>
          <div className="gateway-detail-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => openInvoiceAudit(selectedInvoiceAudit._id)}
            >
              Refresh
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setSelectedInvoiceAuditId(null);
                setSelectedInvoiceAudit(null);
                setInvoiceAuditError("");
              }}
            >
              Close
            </button>
          </div>
        </div>

        <div className="gateway-detail-grid">
          {renderAuditMetaItem("Invoice ID", selectedInvoiceAudit._id, { mono: true })}
          {renderAuditMetaItem("Invoice Number", selectedInvoiceAudit.invoiceNumber, { mono: true })}
          {renderAuditMetaItem(
            "Customer",
            selectedInvoiceAudit.customerName
              ? `${selectedInvoiceAudit.customerName} (${selectedInvoiceAudit.accountNumber || "N/A"})`
              : selectedInvoiceAudit.accountNumber || "-"
          )}
          {renderAuditMetaItem("Plan", selectedInvoiceAudit.planName || "-")}
          {renderAuditMetaItem("Status", formatTokenLabel(selectedInvoiceAudit.status))}
          {renderAuditMetaItem("Dunning", formatTokenLabel(selectedInvoiceAudit.dunningStage || "none"))}
          {renderAuditMetaItem("Total", formatCurrency(selectedInvoiceAudit.totals?.total, selectedInvoiceAudit.currency))}
          {renderAuditMetaItem(
            "Paid",
            formatCurrency(selectedInvoiceAudit.totals?.amountPaid, selectedInvoiceAudit.currency)
          )}
          {renderAuditMetaItem(
            "Credited",
            formatCurrency(selectedInvoiceAudit.totals?.amountCredited, selectedInvoiceAudit.currency)
          )}
          {renderAuditMetaItem(
            "Balance",
            formatCurrency(selectedInvoiceAudit.totals?.balanceDue, selectedInvoiceAudit.currency)
          )}
          {renderAuditMetaItem("Due Date", formatDateOnly(selectedInvoiceAudit.dueDate) || "-")}
          {renderAuditMetaItem("Service Period", servicePeriod)}
          {renderAuditMetaItem(
            "Autopay",
            selectedInvoiceAudit.autopayEnabled
              ? `${formatTokenLabel(selectedInvoiceAudit.autopayStatus || "enabled")} (${selectedInvoiceAudit.autopayAttemptCount || 0} attempt(s))`
              : "Disabled"
          )}
        </div>

        <section className="finance-audit-section">
          <h4>Line Items</h4>
          <div className="finance-audit-table">
            <table className="data-table finance-detail-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Kind</th>
                  <th>Qty</th>
                  <th>Unit Price</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {selectedInvoiceAudit.lineItems?.length ? (
                  selectedInvoiceAudit.lineItems.map((item, index) => (
                    <tr key={`${selectedInvoiceAudit._id}-line-${index}`}>
                      <td>{item.description || "-"}</td>
                      <td>{formatTokenLabel(item.kind || "service")}</td>
                      <td>{item.quantity ?? 0}</td>
                      <td>{formatCurrency(item.unitPrice, selectedInvoiceAudit.currency)}</td>
                      <td>{formatCurrency(item.amount, selectedInvoiceAudit.currency)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center" }}>
                      No line items were stored on this invoice.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="finance-audit-section">
          <h4>Allocations</h4>
          <div className="finance-audit-table">
            <table className="data-table finance-detail-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Reference</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Applied</th>
                  <th>Reversed</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {selectedInvoiceAudit.allocations?.length ? (
                  selectedInvoiceAudit.allocations.map((allocation) => (
                    <tr key={allocation._id}>
                      <td>{formatTokenLabel(allocation.sourceType)}</td>
                      <td>
                        {allocation.payment?.transactionId || allocation.creditNote?.creditNoteNumber || allocation.payment?._id || allocation.creditNote?._id || "-"}
                        <div className="muted-inline">
                          {allocation.payment?.status
                            ? `Payment ${formatTokenLabel(allocation.payment.status)}`
                            : allocation.creditNote?.status
                              ? `Credit ${formatTokenLabel(allocation.creditNote.status)}`
                              : "No linked source"}
                        </div>
                      </td>
                      <td>{formatCurrency(allocation.amount, allocation.currency)}</td>
                      <td>{formatTokenLabel(allocation.status)}</td>
                      <td>{formatDateTime(allocation.appliedAt) || "-"}</td>
                      <td>{formatDateTime(allocation.reversedAt) || "-"}</td>
                      <td className="actions" style={{ textAlign: "right" }}>
                        {allocation.payment?._id ? (
                          <button
                            type="button"
                            className="secondary table-action"
                            onClick={async () => {
                              setActiveTab("payments");
                              await openPaymentAudit(allocation.payment._id);
                            }}
                          >
                            Inspect Payment
                          </button>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center" }}>
                      No allocations have been applied to this invoice yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="finance-audit-section">
          <h4>Source Credits</h4>
          <div className="finance-audit-table">
            <table className="data-table finance-detail-table">
              <thead>
                <tr>
                  <th>Credit Note</th>
                  <th>Amount</th>
                  <th>Remaining</th>
                  <th>Status</th>
                  <th>Reason</th>
                  <th>Issued</th>
                </tr>
              </thead>
              <tbody>
                {selectedInvoiceAudit.sourceCreditNotes?.length ? (
                  selectedInvoiceAudit.sourceCreditNotes.map((note) => (
                    <tr key={note._id}>
                      <td>{note.creditNoteNumber || note._id}</td>
                      <td>{formatCurrency(note.amount, note.currency)}</td>
                      <td>{formatCurrency(note.remainingAmount, note.currency)}</td>
                      <td>{formatTokenLabel(note.status)}</td>
                      <td>{note.reason || "-"}</td>
                      <td>{formatDateTime(note.issuedAt) || "-"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center" }}>
                      No credit notes originated from this invoice.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="finance-audit-section">
          <h4>Ledger Entries</h4>
          <div className="finance-audit-table">
            <table className="data-table finance-detail-table">
              <thead>
                <tr>
                  <th>Effective</th>
                  <th>Account</th>
                  <th>Direction</th>
                  <th>Amount</th>
                  <th>Source</th>
                  <th>Batch</th>
                  <th>Reversed</th>
                </tr>
              </thead>
              <tbody>
                {selectedInvoiceAudit.ledgerEntries?.length ? (
                  selectedInvoiceAudit.ledgerEntries.map((entry) => (
                    <tr key={entry._id}>
                      <td>{formatDateTime(entry.effectiveAt) || "-"}</td>
                      <td>{entry.account || "-"}</td>
                      <td>{formatTokenLabel(entry.direction)}</td>
                      <td>{formatCurrency(entry.amount, entry.currency)}</td>
                      <td>{formatTokenLabel(entry.sourceType)}</td>
                      <td className="mono-text">{entry.batchId || "-"}</td>
                      <td>{formatDateTime(entry.reversedAt) || "-"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center" }}>
                      No ledger entries were linked to this invoice.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div ref={containerRef} className="modal-content large draggable-modal">
        {isDraggingEnabled && (
          <>
            <div className="modal-drag-bar" ref={dragHandleRef}>
              Drag
            </div>
            {resizeHandles.map((dir) => (
              <div
                key={dir}
                className={`modal-resize-handle ${dir.length === 1 ? "edge" : "corner"} ${["n", "s"].includes(dir) ? "horizontal" : ""} ${["e", "w"].includes(dir) ? "vertical" : ""} ${dir}`}
                {...getResizeHandleProps(dir)}
              />
            ))}
          </>
        )}

        <span className="close" onClick={onClose} role="button" aria-label="Close" data-modal-no-drag>
          <FaTimes />
        </span>

        {/* Tabs */}
        <div className="tabs" data-modal-no-drag>
          <button className={activeTab === "payments" ? "active" : ""} onClick={() => setActiveTab("payments")}>
            Payments
          </button>
          <button className={activeTab === "invoices" ? "active" : ""} onClick={() => setActiveTab("invoices")}>
            Invoices
          </button>
          <button className={activeTab === "finance" ? "active" : ""} onClick={() => setActiveTab("finance")}>
            Finance
          </button>
          <button
            className={activeTab === "reconciliation" ? "active" : ""}
            onClick={() => setActiveTab("reconciliation")}
          >
            Reconciliation
          </button>
        </div>

        {/* ===== Payments Tab ===== */}
        {activeTab === "payments" && (
          <>
            <div className="payments-header">
              <h2>Payments</h2>
              <button
                type="button"
                className="secondary"
                onClick={handleExportPayments}
                disabled={!payments.length}
              >
                Export
              </button>
            </div>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Customer</th>
                    <th>Invoice</th>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p._id} className={selectedPaymentAuditId === p._id ? "is-selected" : ""}>
                      <td title={p._id}>{p._id}</td>
                      <td>{p.customerName || p.customer?.name || "-"}</td>
                      <td>{p.invoiceNumber || p.invoice?.invoiceNumber || "-"}</td>
                      <td>{p.amount}</td>
                      <td>{p.method}</td>
                      <td>{p.status}</td>
                      <td>{p.createdAt ? new Date(p.createdAt).toLocaleString() : "-"}</td>
                      <td className="actions" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button
                          className="secondary table-action"
                          type="button"
                          onClick={() => openPaymentAudit(p._id)}
                        >
                          Inspect
                        </button>
                        {(p.status === "Success" || p.status === "Validated") && (
                          <>
                            <button
                              className="secondary table-action"
                              type="button"
                              onClick={() => runPaymentLifecycleAction(p, "refund")}
                              disabled={runningPaymentActionId === `refund:${p._id}`}
                            >
                              {runningPaymentActionId === `refund:${p._id}` ? "Refunding..." : "Refund"}
                            </button>
                            <button
                              className="secondary table-action"
                              type="button"
                              onClick={() => runPaymentLifecycleAction(p, "reverse")}
                              disabled={runningPaymentActionId === `reverse:${p._id}`}
                            >
                              {runningPaymentActionId === `reverse:${p._id}` ? "Reversing..." : "Reverse"}
                            </button>
                            <button
                              className="secondary table-action"
                              type="button"
                              onClick={() => runPaymentLifecycleAction(p, "chargeback")}
                              disabled={runningPaymentActionId === `chargeback:${p._id}`}
                            >
                              {runningPaymentActionId === `chargeback:${p._id}` ? "Posting..." : "Chargeback"}
                            </button>
                          </>
                        )}
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
                      <td colSpan={8} style={{ textAlign: "center" }}>
                        No payments yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {renderPaymentAuditPanel()}

            {!!adjustToast && (
              <div className={`payments-toast ${adjustToast.type}`} role="status" aria-live="polite">
                {adjustToast.message}
              </div>
            )}

            <h3>Manual Payment Validation</h3>
            <form onSubmit={handleManualValidation} className="stacked-form" ref={manualDropdownRef}>
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

              <button type="submit" className="primary">
                <MdAdd className="inline-icon" /> Validate Payment
              </button>
            </form>

            <h3>Backdate & Goodwill Adjustment</h3>
            <form onSubmit={handleAdjustment} className="stacked-form" ref={adjustDropdownRef}>
              <div className="field">
                <input
                  type="text"
                  placeholder="Search customer by name or account number"
                  value={adjustSearchTerm}
                  onChange={(e) => setAdjustSearchTerm(e.target.value)}
                  autoComplete="off"
                />
                {adjustLoading && <div className="help-text">Searching...</div>}
                {adjustSearchError && <div className="error-text">{adjustSearchError}</div>}

                {adjustResults.length > 0 && (
                  <ul className="search-dropdown">
                    {adjustResults.map((c) => (
                      <li
                        key={`adjust-${c._id}`}
                        onClick={() => {
                          setAdjustForm((prev) => ({
                            ...prev,
                            customerId: c._id,
                            accountNumber: c.accountNumber || "",
                            customerName: c.name || "",
                          }));
                          setAdjustSearchTerm(`${c.name} (${c.accountNumber})`);
                          setAdjustResults([]);
                          setAdjustSearchError("");
                        }}
                        title={`${c.name} - ${c.accountNumber}`}
                      >
                        {c.name} - {c.accountNumber}
                      </li>
                    ))}
                  </ul>
                )}

                {adjustResults.length === 0 && adjustSearchTerm.trim() && !adjustLoading && !adjustSearchError && !adjustForm.customerId && (
                  <div className="search-empty">No matching customers</div>
                )}

                {adjustForm.customerId && (
                  <div className="selected-customer">
                    <span>
                      {adjustForm.customerName || "Selected customer"} ({adjustForm.accountNumber || "N/A"})
                    </span>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        setAdjustForm({
                          customerId: null,
                          accountNumber: "",
                          customerName: "",
                          backdateTo: "",
                          extendDays: "",
                          notes: "",
                        });
                        setAdjustSearchTerm("");
                        setAdjustResults([]);
                        setAdjustSearchError("");
                      }}
                    >
                      Change
                    </button>
                  </div>
                )}
              </div>

              <div className="field">
                <label>Backdate To (optional)</label>
                <input
                  type="date"
                  value={adjustForm.backdateTo}
                  onChange={(e) => setAdjustForm((p) => ({ ...p, backdateTo: e.target.value }))}
                />
                <p className="help-text">Sets the billing cycle anchor; expiry = backdate + plan duration.</p>
              </div>

              <div className="field">
                <label>Goodwill Days (optional)</label>
                <input
                  type="number"
                  step="1"
                  value={adjustForm.extendDays}
                  onChange={(e) => setAdjustForm((p) => ({ ...p, extendDays: e.target.value }))}
                />
                <p className="help-text">Adds (or subtracts) days to the computed expiry after backdating.</p>
              </div>

              <div className="field">
                <label>Adjustment Notes (optional)</label>
                <input
                  type="text"
                  value={adjustForm.notes}
                  onChange={(e) => setAdjustForm((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="Reason for adjustment"
                />
              </div>

              <button type="submit" className="primary" disabled={adjustSaving}>
                {adjustSaving ? "Applying..." : "Apply Adjustment"}
              </button>
            </form>
          </>
        )}

        {/* ===== Invoices Tab ===== */}
        {activeTab === "invoices" && (
          <>
            <h2>Invoices</h2>
            <h3>Issue Invoice</h3>
            <form onSubmit={submitInvoiceIssue} className="stacked-form" ref={invoiceDropdownRef}>
              <div className="field">
                <input
                  type="text"
                  placeholder="Search customer by name or account number"
                  value={invoiceSearchTerm}
                  onChange={(e) => setInvoiceSearchTerm(e.target.value)}
                  autoComplete="off"
                />
                {invoiceSearchLoading && <div className="help-text">Searching...</div>}
                {invoiceSearchError && <div className="error-text">{invoiceSearchError}</div>}

                {invoiceResults.length > 0 && (
                  <ul className="search-dropdown">
                    {invoiceResults.map((customer) => (
                      <li
                        key={`invoice-${customer._id}`}
                        onClick={() => {
                          setInvoiceForm((prev) => ({
                            ...prev,
                            customerId: customer._id,
                            customerName: customer.name || "",
                            accountNumber: customer.accountNumber || "",
                            planId: customer.plan?._id || "",
                            amount:
                              customer.plan?.price !== undefined && customer.plan?.price !== null
                                ? String(customer.plan.price)
                                : prev.amount,
                          }));
                          setInvoiceSearchTerm(`${customer.name} (${customer.accountNumber})`);
                          setInvoiceResults([]);
                          setInvoiceSearchError("");
                        }}
                        title={`${customer.name} - ${customer.accountNumber}`}
                      >
                        {customer.name} - {customer.accountNumber}
                      </li>
                    ))}
                  </ul>
                )}

                {hasNoInvoiceSearchResults && <div className="search-empty">No matching customers</div>}

                {invoiceForm.customerId && (
                  <div className="selected-customer">
                    <span>
                      {invoiceForm.customerName || "Selected customer"} ({invoiceForm.accountNumber || "N/A"})
                    </span>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        setInvoiceForm({
                          customerId: null,
                          customerName: "",
                          accountNumber: "",
                          planId: "",
                          amount: "",
                          dueDate: "",
                          servicePeriodStart: "",
                          servicePeriodEnd: "",
                          billingReason: "manual",
                        });
                        setInvoiceSearchTerm("");
                        setInvoiceResults([]);
                        setInvoiceSearchError("");
                      }}
                    >
                      Change
                    </button>
                  </div>
                )}
              </div>

              <div className="field">
                <select
                  value={invoiceForm.planId}
                  onChange={(e) => handleInvoicePlanChange(e.target.value)}
                >
                  <option value="">Select plan</option>
                  {plans.map((plan) => (
                    <option key={plan._id} value={plan._id}>
                      {plan.name} - KES {Number(plan.price || 0).toFixed(2)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Amount (optional override)"
                  value={invoiceForm.amount}
                  onChange={(e) => setInvoiceForm((prev) => ({ ...prev, amount: e.target.value }))}
                />
              </div>

              <div className="field">
                <input
                  type="date"
                  value={invoiceForm.dueDate}
                  onChange={(e) => setInvoiceForm((prev) => ({ ...prev, dueDate: e.target.value }))}
                />
                <p className="help-text">Due date for collections and aging.</p>
              </div>

              <div className="field">
                <input
                  type="date"
                  value={invoiceForm.servicePeriodStart}
                  onChange={(e) =>
                    setInvoiceForm((prev) => ({ ...prev, servicePeriodStart: e.target.value }))
                  }
                />
                <p className="help-text">Optional service period start.</p>
              </div>

              <div className="field">
                <input
                  type="date"
                  value={invoiceForm.servicePeriodEnd}
                  onChange={(e) =>
                    setInvoiceForm((prev) => ({ ...prev, servicePeriodEnd: e.target.value }))
                  }
                />
                <p className="help-text">Optional service period end.</p>
              </div>

              <div className="field">
                <select
                  value={invoiceForm.billingReason}
                  onChange={(e) =>
                    setInvoiceForm((prev) => ({ ...prev, billingReason: e.target.value }))
                  }
                >
                  <option value="manual">Manual</option>
                  <option value="renewal">Renewal</option>
                  <option value="proration">Proration</option>
                  <option value="adjustment">Adjustment</option>
                  <option value="migration">Migration</option>
                </select>
              </div>

              <button type="submit" className="primary" disabled={invoiceSaving}>
                {invoiceSaving ? "Issuing..." : "Issue Invoice"}
              </button>
            </form>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Customer</th>
                    <th>Total</th>
                    <th>Paid</th>
                    <th>Credit</th>
                    <th>Balance</th>
                    <th>Status</th>
                    <th>Dunning</th>
                    <th>Due Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv._id} className={selectedInvoiceAuditId === inv._id ? "is-selected" : ""}>
                      <td>{inv.invoiceNumber || inv._id}</td>
                      <td>{inv.customerName || inv.customer?.name || "-"}</td>
                      <td>{Number(inv.total ?? inv.amount ?? 0).toFixed(2)}</td>
                      <td>{Number(inv.amountPaid ?? 0).toFixed(2)}</td>
                      <td>{Number(inv.amountCredited ?? 0).toFixed(2)}</td>
                      <td>{Number(inv.balanceDue ?? inv.amountDue ?? 0).toFixed(2)}</td>
                      <td>{inv.status}</td>
                      <td>{inv.dunningStage || "-"}</td>
                      <td>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "-"}</td>
                      <td className="actions">
                        <button type="button" className="secondary table-action" onClick={() => openInvoiceAudit(inv._id)}>
                          Inspect
                        </button>
                        {Number(inv.balanceDue ?? inv.amountDue ?? 0) > 0 && (
                          <button onClick={() => markInvoicePaid(inv._id)}>Settle</button>
                        )}
                        {!inv.generated && <button onClick={() => generateInvoice(inv._id)}>Generate</button>}
                        <button onClick={() => viewInvoicePDF(inv._id)}>View PDF</button>
                      </td>
                    </tr>
                  ))}
                  {invoices.length === 0 && (
                    <tr>
                      <td colSpan={10} style={{ textAlign: "center" }}>
                        No invoices yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {renderInvoiceAuditPanel()}
          </>
        )}

        {activeTab === "finance" && (
          <>
            <div className="payments-header">
              <div>
                <h2>Finance</h2>
                <p className="section-subtitle">
                  Review invoice aging, unapplied credits, and recent ledger movement from the finance core.
                </p>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={fetchFinanceReports}
                disabled={financeLoading || !canViewFinance}
              >
                {financeLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            {!canViewFinance ? (
              <div className="gateway-empty-panel">Finance reporting is restricted to owner and admin roles.</div>
            ) : (
              <>
                {financeError ? (
                  <div className="gateway-alert danger">
                    <strong>Finance load failed:</strong> {financeError}
                  </div>
                ) : null}

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                    gap: 12,
                    marginBottom: 18,
                  }}
                >
                  {[
                    ["Invoiced", financeSummary?.totalInvoiced],
                    ["Outstanding", financeSummary?.totalOutstanding],
                    ["Overdue", financeSummary?.overdueOutstanding],
                    ["Credits", financeSummary?.unappliedCredits],
                    ["Collected", financeSummary?.collectedCash],
                    ["Refunded", financeSummary?.refundedCash],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      style={{
                        border: "1px solid rgba(148, 163, 184, 0.25)",
                        borderRadius: 14,
                        padding: "14px 16px",
                        background: "rgba(255,255,255,0.02)",
                      }}
                    >
                      <div className="muted-inline">{label}</div>
                      <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>
                        KES {Number(value || 0).toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>

                <h3>Invoice Aging</h3>
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th>Customer</th>
                        <th>Status</th>
                        <th>Bucket</th>
                        <th>Days</th>
                        <th>Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(financeAging.rows || []).slice(0, 12).map((row) => (
                        <tr key={row._id}>
                          <td>{row.invoiceNumber || row._id}</td>
                          <td>{row.customerName || "-"}</td>
                          <td>{row.status}</td>
                          <td>{row.bucket}</td>
                          <td>{row.daysOverdue}</td>
                          <td>KES {Number(row.balanceDue || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                      {(financeAging.rows || []).length === 0 && (
                        <tr>
                          <td colSpan={6} style={{ textAlign: "center" }}>
                            No open invoice aging items.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <h3>Customer Credits</h3>
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Credit Note</th>
                        <th>Customer</th>
                        <th>Reason</th>
                        <th>Amount</th>
                        <th>Remaining</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {financeCredits.map((note) => (
                        <tr key={note._id}>
                          <td>{note.creditNoteNumber || note._id}</td>
                          <td>{note.customerName || "-"}</td>
                          <td>{note.reason || "-"}</td>
                          <td>KES {Number(note.amount || 0).toFixed(2)}</td>
                          <td>KES {Number(note.remainingAmount || 0).toFixed(2)}</td>
                          <td>{note.status}</td>
                        </tr>
                      ))}
                      {financeCredits.length === 0 && (
                        <tr>
                          <td colSpan={6} style={{ textAlign: "center" }}>
                            No open customer credits.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <h3>Recent Ledger</h3>
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Batch</th>
                        <th>Source</th>
                        <th>Account</th>
                        <th>Direction</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {financeLedger.map((entry) => (
                        <tr key={entry._id}>
                          <td>{entry.effectiveAt ? new Date(entry.effectiveAt).toLocaleString() : "-"}</td>
                          <td title={entry.batchId}>{entry.batchId}</td>
                          <td>{entry.sourceType}</td>
                          <td>{entry.account}</td>
                          <td>{entry.direction}</td>
                          <td>KES {Number(entry.amount || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                      {financeLedger.length === 0 && (
                        <tr>
                          <td colSpan={6} style={{ textAlign: "center" }}>
                            No ledger entries yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {activeTab === "reconciliation" && (
          <>
            <div className="payments-header">
              <div>
                <h2>Payment Reconciliation</h2>
                <p className="section-subtitle">
                  Review webhook and callback receipts, then inspect unmatched or failed events before manual follow-up.
                </p>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => fetchGatewayEvents(gatewayFilters)}
                disabled={gatewayLoading}
              >
                {gatewayLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            <form className="gateway-filters" onSubmit={applyGatewayFilters}>
              <label className="field">
                <span>Provider</span>
                <select
                  value={gatewayFilters.provider}
                  onChange={(e) => setGatewayFilters((current) => ({ ...current, provider: e.target.value }))}
                >
                  <option value="">All providers</option>
                  <option value="mpesa">M-Pesa</option>
                  <option value="stripe">Stripe</option>
                </select>
              </label>

              <label className="field">
                <span>Kind</span>
                <select
                  value={gatewayFilters.kind}
                  onChange={(e) => setGatewayFilters((current) => ({ ...current, kind: e.target.value }))}
                >
                  <option value="">All kinds</option>
                  <option value="stk-callback">STK Callback</option>
                  <option value="c2b-confirmation">C2B Confirmation</option>
                  <option value="webhook">Webhook</option>
                </select>
              </label>

              <label className="field">
                <span>Status</span>
                <select
                  value={gatewayFilters.eventStatus}
                  onChange={(e) => setGatewayFilters((current) => ({ ...current, eventStatus: e.target.value }))}
                >
                  <option value="">All statuses</option>
                  <option value="processed">Processed</option>
                  <option value="processing">Processing</option>
                  <option value="received">Received</option>
                  <option value="unmatched">Unmatched</option>
                  <option value="failed">Failed</option>
                  <option value="rejected">Rejected</option>
                </select>
              </label>

              <label className="field">
                <span>Payment ID</span>
                <input
                  type="text"
                  placeholder="Exact payment id"
                  value={gatewayFilters.paymentId}
                  onChange={(e) => setGatewayFilters((current) => ({ ...current, paymentId: e.target.value }))}
                />
              </label>

              <label className="field">
                <span>Rows</span>
                <select
                  value={gatewayFilters.limit}
                  onChange={(e) => setGatewayFilters((current) => ({ ...current, limit: e.target.value }))}
                >
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                  <option value="200">200</option>
                </select>
              </label>

              <div className="gateway-filter-actions">
                <button type="submit" className="primary" disabled={gatewayLoading}>
                  {gatewayLoading ? "Loading..." : "Apply Filters"}
                </button>
                <button type="button" className="secondary" onClick={resetGatewayFilters} disabled={gatewayLoading}>
                  Reset
                </button>
              </div>
            </form>

            <div className="gateway-summary-row">
              <span className="gateway-summary-copy">
                Showing {gatewayEvents.length} event{gatewayEvents.length === 1 ? "" : "s"} in the current filter window.
              </span>
              <div className="gateway-summary-pills">
                {Object.entries(gatewayStatusSummary).map(([status, count]) => (
                  <span key={status} className={`status-pill status-${getGatewayStatusTone(status)}`}>
                    {count} {formatTokenLabel(status)}
                  </span>
                ))}
              </div>
            </div>

            {gatewayError && (
              <div className="payments-toast error" role="alert">
                {gatewayError}
              </div>
            )}

            {!!gatewayActionMessage && (
              <div className={`payments-toast ${gatewayActionMessage.type}`} role="status" aria-live="polite">
                {gatewayActionMessage.message}
              </div>
            )}

            <div className="table-wrapper">
              <table className="data-table gateway-table">
                <thead>
                  <tr>
                    <th>Received</th>
                    <th>Provider</th>
                    <th>Kind</th>
                    <th>Status</th>
                    <th>Amount</th>
                    <th>Account / Phone</th>
                    <th>Payment</th>
                    <th>Correlation</th>
                    <th>Attempts</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {gatewayEvents.map((event) => {
                    const correlation =
                      event.transactionId || event.externalId || event.externalRef || event.accountNumber || "-";
                    return (
                      <tr key={event._id} className={selectedGatewayEventId === event._id ? "is-selected" : ""}>
                        <td>{formatDateTime(event.createdAt) || "-"}</td>
                        <td>{formatTokenLabel(event.provider)}</td>
                        <td>{formatTokenLabel(event.kind)}</td>
                        <td>
                          <span className={`status-pill status-${getGatewayStatusTone(event.eventStatus)}`}>
                            {formatTokenLabel(event.eventStatus)}
                          </span>
                        </td>
                        <td>
                          {event.amount ?? "-"}
                          {event.amount ? ` ${event.currency || "KES"}` : ""}
                        </td>
                        <td>
                          <div>{event.accountNumber || "-"}</div>
                          <div className="muted-inline">{event.phoneNumber || "-"}</div>
                        </td>
                        <td title={event.paymentId || ""}>{event.paymentId || "-"}</td>
                        <td title={correlation}>{correlation}</td>
                        <td>
                          {event.attemptCount || 0} run
                          {(event.attemptCount || 0) === 1 ? "" : "s"}
                          {" / "}
                          {event.duplicateCount || 0} dup
                        </td>
                        <td className="actions" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <button
                            type="button"
                            className="secondary table-action"
                            onClick={() => openGatewayEvent(event._id)}
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!gatewayLoading && gatewayEvents.length === 0 && (
                    <tr>
                      <td colSpan={10} style={{ textAlign: "center" }}>
                        No gateway events match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {gatewayDetailError && (
              <div className="gateway-alert danger">
                <strong>Detail load failed:</strong> {gatewayDetailError}
              </div>
            )}

            {gatewayDetailLoading ? (
              <div className="gateway-empty-panel">Loading gateway event detail...</div>
            ) : selectedGatewayEvent ? (
              <div className="gateway-event-detail">
                <div className="gateway-event-detail-header">
                  <div>
                    <h3>Gateway Event Details</h3>
                    <p className="section-subtitle">
                      Review the captured receipt, inspect the failure reason, and retry unresolved events once the underlying issue is fixed.
                    </p>
                  </div>
                  <div className="gateway-detail-actions">
                    {canRetryGatewayEvent ? (
                      <button
                        type="button"
                        className="primary"
                        onClick={() => retryGatewayEvent(selectedGatewayEvent._id)}
                        disabled={retryingGatewayEventId === selectedGatewayEvent._id}
                      >
                        {retryingGatewayEventId === selectedGatewayEvent._id ? "Retrying..." : "Retry Event"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setSelectedGatewayEventId(null);
                        setSelectedGatewayEvent(null);
                        setGatewayDetailError("");
                      }}
                    >
                      Close Detail
                    </button>
                  </div>
                </div>

                <div className="gateway-detail-grid">
                  <div className="gateway-detail-item">
                    <span className="gateway-detail-label">Event ID</span>
                    <span className="gateway-detail-value mono-text">{selectedGatewayEvent._id}</span>
                  </div>
                  <div className="gateway-detail-item">
                    <span className="gateway-detail-label">Provider</span>
                    <span className="gateway-detail-value">{formatTokenLabel(selectedGatewayEvent.provider)}</span>
                  </div>
                  <div className="gateway-detail-item">
                    <span className="gateway-detail-label">Kind</span>
                    <span className="gateway-detail-value">{formatTokenLabel(selectedGatewayEvent.kind)}</span>
                  </div>
                  <div className="gateway-detail-item">
                    <span className="gateway-detail-label">Status</span>
                    <span className="gateway-detail-value">
                      <span className={`status-pill status-${getGatewayStatusTone(selectedGatewayEvent.eventStatus)}`}>
                        {formatTokenLabel(selectedGatewayEvent.eventStatus)}
                      </span>
                    </span>
                  </div>
                  <div className="gateway-detail-item">
                    <span className="gateway-detail-label">Received</span>
                    <span className="gateway-detail-value">{formatDateTime(selectedGatewayEvent.createdAt) || "-"}</span>
                  </div>
                  <div className="gateway-detail-item">
                    <span className="gateway-detail-label">Handled</span>
                    <span className="gateway-detail-value">{formatDateTime(selectedGatewayEvent.handledAt) || "-"}</span>
                  </div>
                  <div className="gateway-detail-item">
                    <span className="gateway-detail-label">Matched By</span>
                    <span className="gateway-detail-value">{formatTokenLabel(selectedGatewayEvent.matchedBy) || "-"}</span>
                  </div>
                  <div className="gateway-detail-item">
                    <span className="gateway-detail-label">Payment ID</span>
                    <span className="gateway-detail-value mono-text">{selectedGatewayEvent.paymentId || "-"}</span>
                  </div>
                  <div className="gateway-detail-item">
                    <span className="gateway-detail-label">Account Number</span>
                    <span className="gateway-detail-value">{selectedGatewayEvent.accountNumber || "-"}</span>
                  </div>
                  <div className="gateway-detail-item">
                    <span className="gateway-detail-label">Phone Number</span>
                    <span className="gateway-detail-value">{selectedGatewayEvent.phoneNumber || "-"}</span>
                  </div>
                  <div className="gateway-detail-item">
                    <span className="gateway-detail-label">Transaction ID</span>
                    <span className="gateway-detail-value mono-text">{selectedGatewayEvent.transactionId || "-"}</span>
                  </div>
                  <div className="gateway-detail-item">
                    <span className="gateway-detail-label">External Reference</span>
                    <span className="gateway-detail-value mono-text">
                      {selectedGatewayEvent.externalId || selectedGatewayEvent.externalRef || "-"}
                    </span>
                  </div>
                  <div className="gateway-detail-item">
                    <span className="gateway-detail-label">Amount</span>
                    <span className="gateway-detail-value">
                      {selectedGatewayEvent.amount ?? "-"}
                      {selectedGatewayEvent.amount ? ` ${selectedGatewayEvent.currency || "KES"}` : ""}
                    </span>
                  </div>
                  <div className="gateway-detail-item">
                    <span className="gateway-detail-label">Result</span>
                    <span className="gateway-detail-value">
                      {selectedGatewayEvent.resultCode ?? "-"}
                      {selectedGatewayEvent.resultDesc ? ` - ${selectedGatewayEvent.resultDesc}` : ""}
                    </span>
                  </div>
                  <div className="gateway-detail-item">
                    <span className="gateway-detail-label">Processing Attempts</span>
                    <span className="gateway-detail-value">
                      {selectedGatewayEvent.attemptCount || 0} attempt(s), {selectedGatewayEvent.duplicateCount || 0} duplicate receipt(s)
                    </span>
                  </div>
                </div>

                {selectedGatewayEvent.processingError && (
                  <div className="gateway-alert danger">
                    <strong>Processing error:</strong> {selectedGatewayEvent.processingError}
                  </div>
                )}

                {canResolveGatewayEvent ? (
                  <div className="gateway-resolution-panel">
                    <div className="gateway-resolution-header">
                      <div>
                        <h4>
                          {gatewayResolutionType === "payment"
                            ? "Manual Payment Binding"
                            : "Manual Customer Binding"}
                        </h4>
                        <p className="section-subtitle">
                          {gatewayResolutionType === "payment"
                            ? "Use this when the receipt belongs to an existing pending or failed payment that automatic matching missed."
                            : "Use this when the receipt should be applied to a specific customer and the system could not identify the correct account automatically."}
                        </p>
                      </div>
                    </div>

                    <div className="gateway-resolution-controls">
                      <label className="field">
                        <span>Search Target</span>
                        <input
                          type="text"
                          value={gatewayResolutionQuery}
                          onChange={(e) => setGatewayResolutionQuery(e.target.value)}
                          placeholder={gatewayResolutionPlaceholder}
                        />
                        {gatewayResolutionLoading ? <div className="help-text">Searching...</div> : null}
                        {gatewayResolutionError ? <div className="error-text">{gatewayResolutionError}</div> : null}
                      </label>

                      <label className="field gateway-note-field">
                        <span>Resolution Note</span>
                        <input
                          type="text"
                          value={gatewayResolutionNote}
                          onChange={(e) => setGatewayResolutionNote(e.target.value)}
                          placeholder="Optional note for the audit trail"
                        />
                      </label>
                    </div>

                    {gatewayResolutionResults.length > 0 ? (
                      <div className="gateway-resolution-results">
                        {gatewayResolutionResults.map((item) => (
                          <div key={item._id} className="gateway-resolution-card">
                            <div className="gateway-resolution-copy">
                              <strong>
                                {gatewayResolutionType === "payment"
                                  ? item.customerName || "Unknown customer"
                                  : item.name || "Unnamed customer"}
                              </strong>
                              <div className="muted-inline">
                                {gatewayResolutionType === "payment"
                                  ? `${item.accountNumber || "-"} • ${item.method || "-"}`
                                  : `${item.accountNumber || "-"} • ${item.phone || item.email || "No contact"}`}
                              </div>
                              <div className="gateway-resolution-meta">
                                {gatewayResolutionType === "payment"
                                  ? `KES ${item.amount ?? "-"} • ${item.status || "-"}`
                                  : item.plan?.name
                                    ? `Plan: ${item.plan.name}`
                                    : "No plan assigned"}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="primary"
                              onClick={() => resolveGatewayEvent(item)}
                              disabled={resolvingGatewayEventId === item._id}
                            >
                              {resolvingGatewayEventId === item._id
                                ? "Resolving..."
                                : gatewayResolutionType === "payment"
                                  ? "Resolve to Payment"
                                  : "Resolve to Customer"}
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : gatewayResolutionQuery.trim() && !gatewayResolutionLoading ? (
                      <div className="gateway-empty-panel compact">
                        No eligible {gatewayResolutionType === "payment" ? "payments" : "customers"} matched that search.
                      </div>
                    ) : (
                      <div className="gateway-resolution-hint">
                        {gatewayResolutionType === "payment"
                          ? "Start with the account number from the receipt. Only pending or failed payments for the matching gateway are shown."
                          : "Start with the account number, phone number, or customer name from the receipt."}
                      </div>
                    )}
                  </div>
                ) : null}

                <div className="gateway-detail-columns">
                  <section className="gateway-json-panel">
                    <h4>Payload</h4>
                    <pre>{formatJsonBlock(selectedGatewayEvent.payload)}</pre>
                  </section>
                  <section className="gateway-json-panel">
                    <h4>Headers</h4>
                    <pre>{formatJsonBlock(selectedGatewayEvent.headers)}</pre>
                  </section>
                </div>
              </div>
            ) : (
              <div className="gateway-empty-panel">
                Select <strong>Inspect</strong> on any event to review correlation ids, processing errors, and raw gateway payloads.
              </div>
            )}
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
                    <option value="Chargeback">Chargeback</option>
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
