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
  const [activeTab, setActiveTab] = useState("payments"); // "payments" | "invoices" | "reconciliation"
  const [payments, setPayments] = useState([]);
  const [invoices, setInvoices] = useState([]);
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

  // ------- Edit/Delete state -------
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editPayment, setEditPayment] = useState(null);
  const [confirm, setConfirm] = useState({ open: false, id: null, loading: false, message: "" });

  const manualDropdownRef = useRef(null);
  const adjustDropdownRef = useRef(null);

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

  useEffect(() => {
    if (!isOpen || activeTab !== "reconciliation") return;
    fetchGatewayEvents(gatewayFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab]);

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
      fetchPayments();
      fetchInvoices();
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
      fetchPayments();
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
      setConfirm({ open: false, id: null, loading: false, message: "" });
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
