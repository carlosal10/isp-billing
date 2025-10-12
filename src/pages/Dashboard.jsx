// src/pages/Dashboard.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Chart } from "react-chartjs-2";
import "chart.js/auto";
import "./Dashboard.css";

import StatsCards from "../components/StatsCards";
import UsageModal from "../components/UsageModal";
import CustomerDetailsModal from "../components/CustomerDetailsModal";
import CustomerDetailsPanel from "../components/CustomerDetailsPanel";
import CustomersBrowserModal from "../components/CustomersBrowserModal";

import { useAuth } from "../context/AuthContext";
import { api } from "../lib/apiClient";

/* -----------------------------------
   Constants
----------------------------------- */
const DUE_WINDOW_DAYS = 3;
const REFRESH_FAST_MS = 20000;
const REFRESH_SLOW_MS = 60000;

/* -----------------------------------
   Small utilities
----------------------------------- */
function formatDate(d) {
  if (!d) return "-";
  const t = new Date(d);
  return Number.isFinite(t.getTime()) ? t.toLocaleString() : "-";
}
function daysUntil(date) {
  if (!date) return Infinity;
  const now = Date.now();
  const t = new Date(date).getTime();
  return Math.ceil((t - now) / (1000 * 60 * 60 * 24));
}
function daysSince(date) {
  if (!date) return 0;
  const now = Date.now();
  const t = new Date(date).getTime();
  return Math.ceil((now - t) / (1000 * 60 * 60 * 24));
}
async function retry(fn, { attempts = 2, baseDelay = 400 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, baseDelay * (i + 1)));
    }
  }
  throw lastErr;
}

function accountKeys(value) {
  const raw = (value == null ? "" : String(value)).trim();
  if (!raw) return [];
  const keys = new Set();
  const push = (key) => {
    if (key) keys.add(key);
  };
  push(raw);
  push(raw.toUpperCase());
  push(raw.toLowerCase());
  const compact = raw.replace(/[^A-Za-z0-9]/g, "");
  if (compact && compact !== raw) {
    push(compact);
    push(compact.toUpperCase());
    push(compact.toLowerCase());
  }
  return Array.from(keys);
}

function usePageVisibility() {
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const onVis = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  return visible;
}
function exportCSV(rows) {
  if (!rows || !rows.length) return;
  const headers = [
    "Source",
    "Account",
    "Name",
    "Phone",
    "IP",
    "Uptime",
    "Bytes In",
    "Bytes Out",
    "Plan",
  ];
  const out = [headers, ...rows.map((r) => [
    r.source,
    r.accountNumber,
    r.name,
    r.phone,
    r.ip,
    r.uptime,
    r.bytesIn,
    r.bytesOut,
    r.planName,
  ])]
    .map((a) => a.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([out], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `online-users-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function deriveCreatedAt(customer) {
  if (!customer) return null;
  if (customer.createdAt) {
    const dt = new Date(customer.createdAt);
    return Number.isFinite(dt.getTime()) ? dt : null;
  }
  const rawId = customer._id ? String(customer._id) : "";
  if (rawId.length === 24) {
    const ts = parseInt(rawId.slice(0, 8), 16);
    if (Number.isFinite(ts)) return new Date(ts * 1000);
  }
  return null;
}

function exportCustomers(customers) {
  if (!Array.isArray(customers) || customers.length === 0) return;
  const headers = [
    "Account",
    "Name",
    "Phone",
    "Email",
    "Connection",
    "Status",
    "Plan",
    "Created",
  ];
  const rows = customers.map((c) => {
    const createdAt = deriveCreatedAt(c);
    const planName = typeof c.plan === "object" && c.plan ? c.plan.name : c.plan;
    return [
      c.accountNumber || "-",
      c.name || "-",
      c.phone || "-",
      c.email || "-",
      (c.connectionType || "").toUpperCase(),
      (c.status || "").toUpperCase(),
      planName || "-",
      createdAt ? createdAt.toLocaleString() : "-",
    ];
  });

  const out = [headers, ...rows]
    .map((entry) => entry.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([out], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* -----------------------------------
   Component
----------------------------------- */
export default function Dashboard() {
  const { isAuthenticated, token, ispId } = useAuth();
  const pageVisible = usePageVisibility();

  // router/system state
  const [mikrotik, setMikrotik] = useState({
    connected: false,
    identity: "",
    routerIp: "",
    uptime: "",
  });
  const [stats, setStats] = useState({
    totalCustomers: 0,
    activePlans: 0,
    pendingInvoices: 0,
  });

  // domain data
  const [customers, setCustomers] = useState([]);
  const [payments, setPayments] = useState([]);
  const [pppoeSessions, setPppoeSessions] = useState([]);
  const [hotspotSessions, setHotspotSessions] = useState([]);
  const [staticSessions, setStaticSessions] = useState([]);

  // ui state
  const [loading, setLoading] = useState({
    stats: true,
    customers: true,
    payments: true,
    sessions: true,
    status: true,
  });
  const [errors, setErrors] = useState({});
  const [toast, setToast] = useState(null);
  const toastRef = useRef(null);

  const [showUsageModal, setShowUsageModal] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [customerModal, setCustomerModal] = useState({ open: false, customer: null });
  const [inlineCustomer, setInlineCustomer] = useState(null);

  const [showHotspot, setShowHotspot] = useState(false);
  const [showStatic, setShowStatic] = useState(true);
  const [didMount, setDidMount] = useState(false);

  // search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // pagination for online users
  const [onlinePage, setOnlinePage] = useState(1);
  const pageSize = 10;

  const customersSectionRef = useRef(null);

  /* -----------------------------------
     Fetchers
  ----------------------------------- */
  const loadMikrotikStatus = async () => {
    try {
      setLoading((l) => ({ ...l, status: true }));
      const data = await retry(async () => {
        const a = await api.get("/mikrotik/status");
        if (a.data?.ok) return a.data;
        const b = await api.get("/mikrotik/ping");
        return b.data;
      });
      setMikrotik({
        connected: !!data?.connected,
        identity: data?.identity || data?.routerIdentity || "",
        routerIp: data?.routerIp || data?.ip || "",
        uptime: data?.uptime || "",
      });
      setErrors((e) => ({ ...e, status: null }));
    } catch (e) {
      setMikrotik((m) => ({ ...m, connected: false }));
      setErrors((er) => ({ ...er, status: e.message }));
    } finally {
      setLoading((l) => ({ ...l, status: false }));
    }
  };

  const loadStats = async () => {
    try {
      setLoading((l) => ({ ...l, stats: true }));
      const { data } = await api.get("/stats");
      setStats((s) => ({ ...s, ...data }));
      setErrors((e) => ({ ...e, stats: null }));
    } catch (e) {
      setErrors((er) => ({ ...er, stats: e.message }));
    } finally {
      setLoading((l) => ({ ...l, stats: false }));
    }
  };

  const loadCustomers = async () => {
    try {
      setLoading((l) => ({ ...l, customers: true }));
      const { data } = await api.get("/customers");
      setCustomers(Array.isArray(data) ? data : []);
      setErrors((e) => ({ ...e, customers: null }));
    } catch (e) {
      setErrors((er) => ({ ...er, customers: e.message }));
    } finally {
      setLoading((l) => ({ ...l, customers: false }));
    }
  };

  const loadPayments = async () => {
    try {
      setLoading((l) => ({ ...l, payments: true }));
      const { data } = await api.get("/payments");
      setPayments(Array.isArray(data) ? data : []);
      setErrors((e) => ({ ...e, payments: null }));
    } catch (e) {
      setErrors((er) => ({ ...er, payments: e.message }));
    } finally {
      setLoading((l) => ({ ...l, payments: false }));
    }
  };

  const loadSessions = async () => {
    try {
      setLoading((l) => ({ ...l, sessions: true }));
      const pppoe = await retry(async () => {
        try {
          const { data } = await api.get("/pppoe/active"); // primary
          return Array.isArray(data?.users) ? data.users : (Array.isArray(data) ? data : []);
        } catch {
          const { data } = await api.get("/mikrotik/pppoe/active"); // fallback
          return Array.isArray(data?.users) ? data.users : (Array.isArray(data) ? data : []);
        }
      });

      let hs = [];
      try {
        const { data } = await api.get("/hotspot/active");
        hs = Array.isArray(data?.users) ? data.users : (Array.isArray(data) ? data : []);
      } catch {
        hs = [];
      }

      let st = [];
      try {
        const { data } = await api.get("/static/active");
        st = Array.isArray(data?.users) ? data.users : (Array.isArray(data) ? data : []);
      } catch {
        st = [];
      }

      setPppoeSessions(pppoe);
      setHotspotSessions(hs);
      setStaticSessions(st);
      setErrors((e) => ({ ...e, sessions: null }));
    } catch (e) {
      setErrors((er) => ({ ...er, sessions: e.message }));
      setPppoeSessions([]);
      setHotspotSessions([]);
      setStaticSessions([]);
    } finally {
      setLoading((l) => ({ ...l, sessions: false }));
    }
  };

  // ---- Actions: PPPoE + Static ----
  const [acting, setActing] = useState({});

  async function enableAccount(account) {
    try {
      setActing((a) => ({ ...a, [account]: true }));
      await api.post(`/pppoe/${encodeURIComponent(account)}/enable`);
      await loadSessions();
    } catch (e) {
      setToast({ type: 'error', message: e?.message || 'Enable failed' });
    } finally {
      setActing((a) => ({ ...a, [account]: false }));
    }
  }

  async function disableAccount(account) {
    try {
      setActing((a) => ({ ...a, [account]: true }));
      await api.post(`/pppoe/${encodeURIComponent(account)}/disable`);
      await loadSessions();
    } catch (e) {
      setToast({ type: 'error', message: e?.message || 'Disable failed' });
    } finally {
      setActing((a) => ({ ...a, [account]: false }));
    }
  }

  async function enableStaticQueue(account) {
    try {
      setActing((a) => ({ ...a, [account]: true }));
      await api.post(`/static/${encodeURIComponent(account)}/enable-queue`);
      await loadSessions();
    } catch (e) {
      setToast({ type: 'error', message: e?.message || 'Enable queue failed' });
    } finally {
      setActing((a) => ({ ...a, [account]: false }));
    }
  }

  async function disableStaticQueue(account) {
    try {
      setActing((a) => ({ ...a, [account]: true }));
      await api.post(`/static/${encodeURIComponent(account)}/disable-queue`);
      await loadSessions();
    } catch (e) {
      setToast({ type: 'error', message: e?.message || 'Disable queue failed' });
    } finally {
      setActing((a) => ({ ...a, [account]: false }));
    }
  }

  /* -----------------------------------
     Lifecycle
  ----------------------------------- */
  useEffect(() => setDidMount(true), []);

  useEffect(() => {
    if (!isAuthenticated || !token || !ispId) return;
    loadMikrotikStatus();
    loadStats();
    loadCustomers();
    loadPayments();
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, token, ispId]);

  // Poll (pause while tab hidden)
  useEffect(() => {
    if (!isAuthenticated || !token || !ispId || !pageVisible) return;
    const id = setInterval(() => {
      loadMikrotikStatus();
      loadSessions();
    }, REFRESH_FAST_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, token, ispId, pageVisible]);

  useEffect(() => {
    if (!isAuthenticated || !token || !ispId || !pageVisible) return;
    const id = setInterval(() => {
      loadStats();
      loadPayments();
      loadCustomers();
    }, REFRESH_SLOW_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, token, ispId, pageVisible]);

  // scroll helper
  const scrollToCustomers = () => {
    try {
      const el =
        customersSectionRef.current ||
        document.querySelector(".pppoe-status-section") ||
        document.body;
      const rect = el.getBoundingClientRect();
      const y = rect.top + window.pageYOffset - 12;
      window.scrollTo({ top: y, behavior: "smooth" });
    } catch {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  useEffect(() => {
    if (!didMount) return;
    if (browseOpen) setTimeout(scrollToCustomers, 0);
  }, [browseOpen, didMount]);

  /* -----------------------------------
     Search (abortable + keyboard nav)
  ----------------------------------- */
  useEffect(() => {
    const q = searchQuery.trim();
    setActiveIndex(-1);
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get(`/customers/search`, {
          params: { query: q },
          signal: ctrl.signal,
        });
        setSearchResults(Array.isArray(data) ? data : []);
      } catch (e) {
        if (e.name !== "CanceledError" && e.name !== "AbortError") {
          setSearchResults([]);
        }
      }
    }, 280);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [searchQuery]);

  function onSearchKey(e) {
    if (!searchResults.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, searchResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      openCustomerDetails(searchResults[activeIndex]);
    } else if (e.key === "Escape") {
      setSearchOpen(false);
    }
  }

  const openCustomerDetails = async (item) => {
    try {
      const id = item?._id || item?.id;
      if (!id) return;
      const { data } = await api.get(`/customers/by-id/${id}`);
      setInlineCustomer(data);
      setCustomerModal({ open: false, customer: null });
      setSearchOpen(false);
      setTimeout(scrollToCustomers, 0);
    } catch (e) {
      setToast({ type: "error", message: e.message });
    }
  };

  /* -----------------------------------
     Data enrichment / memo
  ----------------------------------- */
  const customerByAccount = useMemo(() => {
    const map = new Map();
    for (const c of customers) {
      const baseKeys = accountKeys(c?.accountNumber);
      const aliasKeys = Array.isArray(c?.accountAliases)
        ? c.accountAliases.flatMap((alias) => accountKeys(alias))
        : [];
      const keys = [...baseKeys, ...aliasKeys];
      for (const key of keys) {
        if (key && !map.has(key)) {
          map.set(key, c);
        }
      }
    }
    return map;
  }, [customers]);

  const customerByStaticIp = useMemo(() => {
    const map = new Map();
    for (const c of customers) {
      const ip = c?.staticConfig?.ip;
      if (!ip) continue;
      const raw = String(ip).trim();
      if (raw) {
        if (!map.has(raw)) map.set(raw, c);
        const lower = raw.toLowerCase();
        if (!map.has(lower)) map.set(lower, c);
      }
    }
    return map;
  }, [customers]);

  const enrichedOnline = useMemo(() => {
    const mapSession = (s) => {
      const username =
        s.username || s.name || s.user || s.account || s.login || "";
      const acct = String(username || "").trim();
      const accountCandidates = [
        ...accountKeys(username),
        ...accountKeys(s.accountNumber),
      ];
      let c = null;
      for (const key of accountCandidates) {
        if (!key) continue;
        c = customerByAccount.get(key);
        if (c) break;
      }
      if (!c) {
        const ipRaw = s.address || s.ip || s.ipAddress || "";
        const ipKey = String(ipRaw || "").trim();
        if (ipKey) {
          const candidates = [ipKey, ipKey.toLowerCase()];
          for (const key of candidates) {
            c = customerByStaticIp.get(key);
            if (c) break;
          }
        }
      }
      const status = (c?.status || "").toString().toLowerCase();
      const apiDisabled =
        typeof s.queueDisabled !== "undefined"
          ? !!s.queueDisabled
          : typeof s.disabled !== "undefined"
          ? !!s.disabled
          : undefined;
      const isDisabled =
        apiDisabled !== undefined ? apiDisabled : (status && status !== "active");
      const toNum = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };
      // Prefer provided uptime; for Static sessions, also show lastSeen label
      const uptimeStr = s.uptime || (s.lastSeen ? `Last seen ${s.lastSeen}` : "-");
      const uptimeMs = typeof s.uptimeMs === "number" && Number.isFinite(s.uptimeMs)
        ? s.uptimeMs
        : null;
      const accountNumberOut =
        c?.accountNumber ||
        accountCandidates.find(Boolean) ||
        acct ||
        "-";

      return {
        accountNumber: accountNumberOut,
        name: c?.name || s.fullName || "-",
        phone: c?.phone || "-",
        ip: s.address || s.ip || s.ipAddress || "-",
        uptime: uptimeStr,
        uptimeMs,
        bytesIn: toNum(s.bytesIn || s.rx || s["bytes-in"]),
        bytesOut: toNum(s.bytesOut || s.tx || s["bytes-out"]),
        planName: c?.plan?.name || s.plan || "-",
        source: s.source || "PPPoE",
        isDisabled,
      };
    };

    const ppp = (Array.isArray(pppoeSessions) ? pppoeSessions : []).map((s) => ({
      ...mapSession(s),
      source: "PPPoE",
    }));
    const hs = showHotspot
      ? (Array.isArray(hotspotSessions) ? hotspotSessions : []).map((s) => ({
          ...mapSession(s),
          source: "Hotspot",
        }))
      : [];
    const st = showStatic
      ? (Array.isArray(staticSessions) ? staticSessions : []).map((s) => ({
          ...mapSession(s),
          source: "Static",
        }))
      : [];
    return [...ppp, ...hs, ...st];
  }, [pppoeSessions, hotspotSessions, staticSessions, showHotspot, showStatic, customerByAccount, customerByStaticIp]);

  const onlineTotalPages = useMemo(
    () => Math.max(1, Math.ceil(enrichedOnline.length / pageSize)),
    [enrichedOnline]
  );
  useEffect(() => {
    setOnlinePage((p) => Math.min(Math.max(1, p), onlineTotalPages));
  }, [onlineTotalPages]);

  const onlinePageItems = useMemo(() => {
    const start = (onlinePage - 1) * pageSize;
    return enrichedOnline.slice(start, start + pageSize);
  }, [enrichedOnline, onlinePage]);

  const pageBytesIn = useMemo(
    () =>
      onlinePageItems.reduce(
        (a, u) => a + (Number.isFinite(u.bytesIn) ? u.bytesIn : 0),
        0
      ),
    [onlinePageItems]
  );
  const pageBytesOut = useMemo(
    () =>
      onlinePageItems.reduce(
        (a, u) => a + (Number.isFinite(u.bytesOut) ? u.bytesOut : 0),
        0
      ),
    [onlinePageItems]
  );

  const paymentMetaByCustomerId = useMemo(() => {
    const map = new Map();
    for (const p of payments) {
      if (!p?.customer) continue;
      const cid = typeof p.customer === "string" ? p.customer : p.customer._id;
      if (!cid) continue;
      const meta = map.get(cid) || { expiryDate: null, lastPaymentAt: null };
      if (p.expiryDate) {
        const nextExpiryTs = new Date(p.expiryDate).getTime();
        const currentExpiryTs = meta.expiryDate ? new Date(meta.expiryDate).getTime() : null;
        if (Number.isFinite(nextExpiryTs) && (!Number.isFinite(currentExpiryTs) || nextExpiryTs > currentExpiryTs)) {
          meta.expiryDate = p.expiryDate;
        }
      }
      const paidAt = p.validatedAt || p.createdAt;
      if (paidAt) {
        const nextPaidTs = new Date(paidAt).getTime();
        const currentPaidTs = meta.lastPaymentAt ? new Date(meta.lastPaymentAt).getTime() : null;
        if (Number.isFinite(nextPaidTs) && (!Number.isFinite(currentPaidTs) || nextPaidTs > currentPaidTs)) {
          meta.lastPaymentAt = paidAt;
        }
      }
      map.set(cid, meta);
    }
    return map;
  }, [payments]);

  const dueSoon = useMemo(() => {
    const out = [];
    const now = Date.now();
    const horizon = now + DUE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    for (const c of customers) {
      const cid = c._id;
      const meta = paymentMetaByCustomerId.get(cid);
      const expiry = meta?.expiryDate;
      if (!expiry) continue;
      const t = new Date(expiry).getTime();
      if (t >= now && t <= horizon) {
        out.push({
          accountNumber: c.accountNumber,
          name: c.name,
          phone: c.phone,
          expiryDate: expiry,
          daysLeft: daysUntil(expiry),
          connectionType: c.connectionType || "",
          createdAt: deriveCreatedAt(c),
          lastPaymentAt: meta?.lastPaymentAt || null,
        });
      }
    }
    return out.sort((a, b) => a.daysLeft - b.daysLeft);
  }, [customers, paymentMetaByCustomerId]);

  const expired = useMemo(() => {
    const out = [];
    const now = Date.now();
    for (const c of customers) {
      const cid = c._id;
      const meta = paymentMetaByCustomerId.get(cid);
      const expiry = meta?.expiryDate;
      if (!expiry) continue;
      if (new Date(expiry).getTime() < now) {
        out.push({
          accountNumber: c.accountNumber,
          name: c.name,
          phone: c.phone,
          expiryDate: expiry,
          daysAgo: daysSince(expiry),
          connectionType: c.connectionType || "",
          createdAt: deriveCreatedAt(c),
          lastPaymentAt: meta?.lastPaymentAt || null,
        });
      }
    }
    return out.sort((a, b) => b.daysAgo - a.daysAgo);
  }, [customers, paymentMetaByCustomerId]);

  const computed = useMemo(() => {
    const onlineCount = enrichedOnline.length;
    const dueCount = dueSoon.length;
    const expiredCount = expired.length;
    const totalCustomers = Array.isArray(customers) ? customers.length : 0;
    const staticInactiveCount = Array.isArray(customers)
      ? customers.reduce((acc, c) => {
          if ((c?.connectionType || "").toLowerCase() !== "static") return acc;
          const status = String(c?.status || "").toLowerCase();
          return status && status !== "active" ? acc + 1 : acc;
        }, 0)
      : 0;
    return { onlineCount, dueCount, expiredCount, totalCustomers, staticInactiveCount };
  }, [enrichedOnline, dueSoon, expired, customers]);

  const paymentsChart = useMemo(() => {
    const days = 14;
    const labels = [];
    const map = new Map();
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      labels.push(key);
      map.set(key, 0);
    }
    for (const p of payments) {
      const key = new Date(p.createdAt).toISOString().slice(0, 10);
      if (map.has(key)) map.set(key, (map.get(key) || 0) + Number(p.amount || 0));
    }
    return {
      labels,
      datasets: [
        {
          label: "Payments (KES) - last 14 days",
          data: labels.map((k) => map.get(k) || 0),
          borderColor: "rgb(255,59,59)",
          backgroundColor: "rgba(255,59,59,0.2)",
          tension: 0.3,
          pointRadius: 2,
        },
      ],
    };
  }, [payments]);

  const paymentsOpts = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { mode: "index", intersect: false },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 7 } },
        y: {
          ticks: { callback: (v) => `KES ${Number(v).toLocaleString()}` },
          grid: { color: "rgba(0,0,0,0.05)" },
        },
      },
    }),
    []
  );

  

  useEffect(() => {
    if (toast && toastRef.current) toastRef.current.focus();
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  /* -----------------------------------
     Render
  ----------------------------------- */
  return (
    <div className="dashboard">
      <div className="main-content">
        <header className="page-header">
          <h1>Dashboard</h1>

          <div className="header-search">
            <input
              className="search-input"
              placeholder="Search customers (name, account, phone, email, address)"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={onSearchKey}
            />
            <button
              className="btn"
              onClick={() => { setBrowseOpen(true); setTimeout(scrollToCustomers, 0); }}
              style={{ marginLeft: 8 }}
            >
              Browse All
            </button>
            {searchOpen && searchQuery.trim() && (
              <div className="search-results">
                {searchResults.map((r, i) => (
                  <div
                    key={r._id}
                    className={`search-item ${activeIndex === i ? "active" : ""}`}
                    onClick={() => openCustomerDetails(r)}
                    onMouseEnter={() => setActiveIndex(i)}
                  >
                    <div className="search-primary">
                      {r.name || "-"}{" "}
                      <span className="muted">({r.accountNumber || "-"})</span>
                    </div>
                    <div className="search-secondary">
                      {r.phone || ""}
                      {r.email ? ` • ${r.email}` : ""}
                    </div>
                  </div>
                ))}
                {searchResults.length === 0 && (
                  <div className="search-empty">No matches</div>
                )}
              </div>
            )}
          </div>

          <div
            className={`mikrotik-status ${mikrotik.connected ? "online" : "offline"}`}
            title={mikrotik.routerIp || ""}
          >
            <span className="dot" />
            {mikrotik.connected ? "MikroTik Connected" : "MikroTik Disconnected"}
            {mikrotik.identity ? ` — ${mikrotik.identity}` : ""}{" "}
            {mikrotik.routerIp ? `(${mikrotik.routerIp})` : ""}
            {mikrotik.uptime ? ` • Uptime: ${mikrotik.uptime}` : ""}
          </div>
        </header>

        {/* Stats skeleton while loading */}
        {loading.stats ? (
          <div className="skel-row" aria-hidden>
            <div className="skel" style={{ height: 64 }} />
            <div className="skel" style={{ height: 64 }} />
            <div className="skel" style={{ height: 64 }} />
            <div className="skel" style={{ height: 64 }} />
          </div>
        ) : (
          <StatsCards stats={stats} />
        )}

        <section className="quick-counters">
          <div className="counter">
            <div className="counter-title">Online</div>
            <div className="counter-value">{computed.onlineCount}</div>
          </div>
          <div className="counter">
            <div className="counter-title">Due in {DUE_WINDOW_DAYS}d</div>
            <div className="counter-value">{computed.dueCount}</div>
          </div>
          <div className="counter">
            <div className="counter-title">Expired</div>
            <div className="counter-value">{computed.expiredCount}</div>
          </div>
          <div className="counter">
            <div className="counter-title">Total Customers</div>
            <div className="counter-value">{computed.totalCustomers}</div>
          </div>
          <div className="counter">
            <div className="counter-title">Static Inactive</div>
            <div className="counter-value">{computed.staticInactiveCount}</div>
          </div>
        </section>

        <div ref={customersSectionRef}>
          {/* Inline customer details panel */}
          {inlineCustomer && (
            <div style={{ marginTop: 18 }}>
              <CustomersBrowserModal
                customer={inlineCustomer}
                onClose={() => setInlineCustomer(null)}
              />
            </div>
          )}
          <div
            className="customers-browser-actions"
            style={{
              marginTop: inlineCustomer ? 12 : 18,
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            
          </div>
        </div>

        <section className="pppoe-status-section">
          <div className="section-head">
            <h2>
              Online Users {loading.sessions && <small>(loading…)</small>}
            </h2>
            <label className="toggle">
              <input
                type="checkbox"
                checked={showHotspot}
                onChange={() => setShowHotspot((v) => !v)}
              />
              Include Hotspot
            </label>
            <label className="toggle" style={{ marginLeft: 12 }}>
              <input
                type="checkbox"
                checked={showStatic}
                onChange={() => setShowStatic((v) => !v)}
              />
              Include Static
            </label>
            <div className="section-actions">
              <button className="btn" onClick={() => setShowUsageModal(true)}>
                Usage
              </button>
              <button className="btn" onClick={() => exportCSV(enrichedOnline)}>
                Export CSV
              </button>
            </div>
          </div>

          {!loading.sessions && enrichedOnline.length === 0 && !errors.sessions && (
            <div
              style={{
                marginTop: 10,
                padding: "12px 14px",
                border: "1px solid #e8ecf4",
                borderRadius: 10,
                background: "#fff",
              }}
            >
              <strong>No users online.</strong>{" "}
              Tip: check <em>MikroTik Connected</em> status, confirm PPPoE secrets, or{" "}
              <button className="btn" onClick={loadSessions} style={{ padding: "2px 8px" }}>
                Refresh
              </button>
              .
            </div>
          )}

          <div className="table-wrapper" style={{ marginTop: 10 }}>
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Account #</th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>IP</th>
                  <th>Uptime</th>
                  <th>Bytes In</th>
                  <th>Bytes Out</th>
                  <th>Plan</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {onlinePageItems.map((u, i) => (
                  <tr key={`${u.accountNumber}-${i}`}>
                    <td>{u.source}</td>
                    <td>{u.accountNumber}</td>
                    <td>{u.name}</td>
                    <td>{u.phone}</td>
                    <td>{u.ip}</td>
                    <td>{u.uptime}</td>
                    <td className="num">{u.bytesIn.toLocaleString()}</td>
                    <td className="num">{u.bytesOut.toLocaleString()}</td>
                    <td>{u.planName}</td>
                    <td>
                      {u.source === 'Static' && u.accountNumber && (
                        <div className="static-actions" style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                          <button
                            className="btn"
                            style={{ display: u.isDisabled ? 'none' : undefined }}
                            onClick={() => disableStaticQueue(u.accountNumber)}
                            disabled={!!acting[u.accountNumber]}
                          >
                            {acting[u.accountNumber] ? 'Working…' : 'Disable Queue'}
                          </button>
                          <button
                            className="btn"
                            style={{ display: u.isDisabled ? undefined : 'none' }}
                            onClick={() => enableStaticQueue(u.accountNumber)}
                            disabled={!!acting[u.accountNumber]}
                          >
                            {acting[u.accountNumber] ? '…' : 'Enable Queue'}
                          </button>
                        </div>
                      )}
                      {u.source === "PPPoE" && u.accountNumber ? (
                        <div className="ppp-actions" data-disabled={u.isDisabled ? '1' : '0'} style={{ display: "flex", gap: 6 }}>
                          <button
                            className="btn"
                            onClick={() => disableAccount(u.accountNumber)}
                            disabled={!!acting[u.accountNumber]}
                          >
                            {acting[u.accountNumber] ? "Working…" : "Disable"}
                          </button>
                          <button
                            className="btn"
                            onClick={() => enableAccount(u.accountNumber)}
                            disabled={!!acting[u.accountNumber]}
                          >
                            {acting[u.accountNumber] ? "…" : "Enable"}
                          </button>
                        </div>
                      ) : u.source === 'Static' ? (null) : (
                        <span style={{ opacity: 0.5 }}>-</span>
                      )}
                    </td>
                  </tr>
                ))}
                {enrichedOnline.length === 0 && (
                  <tr>
                    <td colSpan={10} style={{ textAlign: "center" }}>
                      {errors.sessions
                        ? `Failed to load sessions: ${errors.sessions}`
                        : isAuthenticated && token && ispId
                        ? "No users online"
                        : "Signing you in…"}
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6} style={{ textAlign: "right", fontWeight: 600 }}>
                    Totals
                  </td>
                  <td className="num">{pageBytesIn.toLocaleString()}</td>
                  <td className="num">{pageBytesOut.toLocaleString()}</td>
                  <td />
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {enrichedOnline.length > pageSize && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 8,
              }}
            >
              <button
                className="btn"
                onClick={() => setOnlinePage((p) => Math.max(1, p - 1))}
                disabled={onlinePage === 1}
              >
                Previous
              </button>
              <div style={{ color: "#000" }}>
                Page {onlinePage} of {onlineTotalPages} • Showing {onlinePageItems.length} of{" "}
                {enrichedOnline.length}
              </div>
              <button
                className="btn"
                onClick={() => setOnlinePage((p) => Math.min(onlineTotalPages, p + 1))}
                disabled={onlinePage === onlineTotalPages}
              >
                Next
              </button>
            </div>
          )}
        </section>

        <section className="due-soon-section">
          <h2>Due to Expire (next {DUE_WINDOW_DAYS} days)</h2>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Account #</th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Connection</th>
                  <th>Last Paid</th>
                  <th>Expiry Date</th>
                  <th>Days Left</th>
                </tr>
              </thead>
              <tbody>
                {dueSoon.map((u, i) => (
                  <tr key={`${u.accountNumber}-due-${i}`}>
                    <td>{u.accountNumber}</td>
                    <td>{u.name}</td>
                    <td>{u.phone}</td>
                    <td>{(u.connectionType || "").toUpperCase() || "-"}</td>
                    <td>{u.createdAt ? formatDate(u.createdAt) : "-"}</td>
                    <td>{formatDate(u.expiryDate)}</td>
                    <td className="num">{u.daysLeft}</td>
                  </tr>
                ))}
                {dueSoon.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center" }}>
                      No accounts due soon.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="expired-section">
          <h2>Expired Users</h2>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Account #</th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Connection</th>
                  <th>Date Created</th>
                  <th>Expired On</th>
                  <th>Last Payment</th>
                  <th>Days Ago</th>
                </tr>
              </thead>
              <tbody>
                {expired.map((u, i) => (
                  <tr key={`${u.accountNumber}-exp-${i}`}>
                    <td>{u.accountNumber}</td>
                    <td>{u.name}</td>
                    <td>{u.phone}</td>
                    <td>{(u.connectionType || "").toUpperCase() || "-"}</td>
                    <td>{u.createdAt ? formatDate(u.createdAt) : "-"}</td>
                    <td>{formatDate(u.expiryDate)}</td>
                    <td>{u.lastPaymentAt ? formatDate(u.lastPaymentAt) : "-"}</td>
                    <td className="num">{u.daysAgo}</td>
                  </tr>
                ))}
                {expired.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center" }}>
                      No expired accounts.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="chart-container">
          <h2>Collections Trend</h2>
          <div style={{ height: 280 }}>
            <Chart type="line" data={paymentsChart} options={paymentsOpts} />
          </div>
        </section>
      </div>

      {!!toast && (
        <div
          ref={toastRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            top: 16,
            right: 16,
            background: toast.type === "success" ? "#16a34a" : "#ef4444",
            color: "#fff",
            padding: "8px 12px",
            borderRadius: 8,
            boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
            zIndex: 1000,
            outline: "none",
          }}
        >
          {toast.message}
        </div>
      )}

      <UsageModal isOpen={showUsageModal} onClose={() => setShowUsageModal(false)} />

      {/* Keep modal wiring available but unused now that inline panel exists */}
      <CustomerDetailsModal
        open={customerModal.open}
        customer={customerModal.customer}
        onClose={() => setCustomerModal({ open: false, customer: null })}
      />
      <CustomersBrowserModal
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        onSelect={(c) => {
          setBrowseOpen(false);
          setInlineCustomer(c);
          setCustomerModal({ open: false, customer: null });
          setTimeout(scrollToCustomers, 0);
        }}
      />
    </div>
  );
}
