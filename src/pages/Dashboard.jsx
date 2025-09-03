// src/pages/Dashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Chart } from "react-chartjs-2";
import "chart.js/auto";
import "./Dashboard.css";

import Sidebar from "../components/Sidebar";
import StatsCards from "../components/StatsCards";
import MODALS from "../constants/modals";

// Modals
import ClientsModal from "../components/CustomersModal";
import PlansModal from "../components/PlanModal";
import PppoeSetupModal from "../components/PppoeModal";
import HotspotSetupModal from "../components/HotspotModal";
import PaymentIntegrationModal from "../components/PaymentSetting";
import ConnectMikrotikModal from "../components/ConnectMikrotik";
import UsageLogsModal from "../components/UsageModal";
import PaymentsModal from "../components/PaymentsModal";
import MikrotikTerminalModal from "../components/MikrotikTerminalModal";

import { useAuth } from "../context/AuthContext";
import { api } from "../lib/apiClient";

const DUE_WINDOW_DAYS = 3;
const REFRESH_FAST_MS = 20000;
const REFRESH_SLOW_MS = 60000;

function formatDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleString();
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

export default function Dashboard() {
  // Sidebar
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== "undefined" && window.matchMedia("(min-width:1024px)").matches
  );
  const [sidebarOpen, setSidebarOpen] = useState(isDesktop);

  useEffect(() => {
    const mq = window.matchMedia("(min-width:1024px)");
    const handler = (e) => {
      setIsDesktop(e.matches);
      setSidebarOpen(e.matches);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const toggleSidebar = () => setSidebarOpen((s) => !s);

  // 🔑 Use token + ispId directly to gate data loads
  const { isAuthenticated, token, ispId } = useAuth();

  const [activeModal, setActiveModal] = useState(null);

  // system & stats
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

  // ui
  const [loading, setLoading] = useState({
    stats: true,
    customers: true,
    payments: true,
    sessions: true,
    status: true,
  });
  const [errors, setErrors] = useState({});

  // toggles
  const [showHotspot, setShowHotspot] = useState(false);

  // ---------- FETCHERS (Axios `api` injects Authorization + x-isp-id) ----------
  const loadMikrotikStatus = async () => {
    try {
      setLoading((l) => ({ ...l, status: true }));
      let { data } = await api.get("/mikrotik/status");
      if (!data?.ok) {
        const ping = await api.get("/mikrotik/ping");
        data = ping.data;
      }
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
      let pppoe = [];
      try {
        const { data } = await api.get("/pppoe/active"); // primary
        pppoe = data?.users || data; // supports both shapes
      } catch {
        const { data } = await api.get("/mikrotik/pppoe/active"); // fallback
        pppoe = data?.users || data;
      }
      setPppoeSessions(Array.isArray(pppoe) ? pppoe : []);

      // hotspot optional
      try {
        const { data: hs } = await api.get("/hotspot/active");
        const list = hs?.users || hs;
        setHotspotSessions(Array.isArray(list) ? list : []);
      } catch {
        setHotspotSessions([]);
      }

      setErrors((e) => ({ ...e, sessions: null }));
    } catch (e) {
      setErrors((er) => ({ ...er, sessions: e.message }));
      setPppoeSessions([]);
      setHotspotSessions([]);
    } finally {
      setLoading((l) => ({ ...l, sessions: false }));
    }
  };

  // ---------- INITIAL LOAD ----------
  useEffect(() => {
    if (!isAuthenticated || !token || !ispId) return;
    loadMikrotikStatus();
    loadStats();
    loadCustomers();
    loadPayments();
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, token, ispId]);

  // ---------- POLLING ----------
  useEffect(() => {
    if (!isAuthenticated || !token || !ispId) return;
    const id = setInterval(() => {
      loadMikrotikStatus();
      loadSessions();
    }, REFRESH_FAST_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, token, ispId]);

  useEffect(() => {
    if (!isAuthenticated || !token || !ispId) return;
    const id = setInterval(() => {
      loadStats();
      loadPayments();
      loadCustomers();
    }, REFRESH_SLOW_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, token, ispId]);

  // ---------- DATA ENRICHMENT ----------
  const customerByAccount = useMemo(() => {
    const map = new Map();
    for (const c of customers) {
      if (c?.accountNumber) map.set(String(c.accountNumber), c);
    }
    return map;
  }, [customers]);

  const enrichedOnline = useMemo(() => {
    const mapSession = (s) => {
      const username = s.username || s.name || s.user || s.account || s.login || "";
      const acct = String(username || "").trim();
      const c = customerByAccount.get(acct);
      return {
        accountNumber: acct || "-",
        name: c?.name || s.fullName || "-",
        phone: c?.phone || "-",
        ip: s.address || s.ip || s.ipAddress || "-",
        uptime: s.uptime || "-",
        bytesIn: Number(s.bytesIn || s.rx || s["bytes-in"] || 0),
        bytesOut: Number(s.bytesOut || s.tx || s["bytes-out"] || 0),
        planName: c?.plan?.name || s.plan || "-",
        source: s.source || "PPPoE",
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
    return [...ppp, ...hs];
  }, [pppoeSessions, hotspotSessions, showHotspot, customerByAccount]);

  const totalBytesIn = useMemo(
    () => enrichedOnline.reduce((a, u) => a + (Number.isFinite(u.bytesIn) ? u.bytesIn : 0), 0),
    [enrichedOnline]
  );
  const totalBytesOut = useMemo(
    () => enrichedOnline.reduce((a, u) => a + (Number.isFinite(u.bytesOut) ? u.bytesOut : 0), 0),
    [enrichedOnline]
  );

  const expiryByCustomerId = useMemo(() => {
    const map = new Map();
    for (const p of payments) {
      if (!p?.customer) continue;
      const cid = typeof p.customer === "string" ? p.customer : p.customer._id;
      const existing = map.get(cid);
      const e = p.expiryDate ? new Date(p.expiryDate).getTime() : null;
      const existingT = existing ? new Date(existing).getTime() : null;
      if (e && (!existingT || e > existingT)) map.set(cid, p.expiryDate);
    }
    return map;
  }, [payments]);

  const dueSoon = useMemo(() => {
    const out = [];
    const now = Date.now();
    const horizon = now + DUE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    for (const c of customers) {
      const cid = c._id;
      const expiry = expiryByCustomerId.get(cid);
      if (!expiry) continue;
      const t = new Date(expiry).getTime();
      if (t >= now && t <= horizon) {
        out.push({
          accountNumber: c.accountNumber,
          name: c.name,
          phone: c.phone,
          expiryDate: expiry,
          daysLeft: daysUntil(expiry),
        });
      }
    }
    return out.sort((a, b) => a.daysLeft - b.daysLeft);
  }, [customers, expiryByCustomerId]);

  const expired = useMemo(() => {
    const out = [];
    const now = Date.now();
    for (const c of customers) {
      const cid = c._id;
      const expiry = expiryByCustomerId.get(cid);
      if (!expiry) continue;
      if (new Date(expiry).getTime() < now) {
        out.push({
          accountNumber: c.accountNumber,
          name: c.name,
          phone: c.phone,
          expiryDate: expiry,
          daysAgo: daysSince(expiry),
        });
      }
    }
    return out.sort((a, b) => b.daysAgo - a.daysAgo);
  }, [customers, expiryByCustomerId]);

  const computed = useMemo(() => {
    const onlineCount = enrichedOnline.length;
    const dueCount = dueSoon.length;
    const expiredCount = expired.length;
    const totalCustomers = Array.isArray(customers) ? customers.length : 0;
    return { onlineCount, dueCount, expiredCount, totalCustomers };
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
        },
      ],
    };
  }, [payments]);

  return (
    <div className="dashboard">
      {/* Hamburger (mobile) */}
      <div className="hamburger" onClick={toggleSidebar} role="button" aria-label="Toggle sidebar">
        ☰
      </div>

      {!isDesktop && sidebarOpen && <div className="sidebar-backdrop" onClick={toggleSidebar} />}

      <Sidebar open={sidebarOpen} toggleSidebar={toggleSidebar} onOpenModal={setActiveModal} />

      <div className="main-content">
        <header className="page-header">
          <h1>Dashboard</h1>

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

        <StatsCards stats={stats} />

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
        </section>

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
          </div>

          <div className="table-wrapper">
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
                </tr>
              </thead>
              <tbody>
                {enrichedOnline.map((u, i) => (
                  <tr key={`${u.accountNumber}-${i}`}>
                    <td>{u.source}</td>
                    <td>{u.accountNumber}</td>
                    <td>{u.name}</td>
                    <td>{u.phone}</td>
                    <td>{u.ip}</td>
                    <td>{u.uptime}</td>
                    <td>{u.bytesIn.toLocaleString()}</td>
                    <td>{u.bytesOut.toLocaleString()}</td>
                    <td>{u.planName}</td>
                  </tr>
                ))}
                {enrichedOnline.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ textAlign: "center" }}>
                      {errors.sessions
                        ? `Failed to load sessions: ${errors.sessions}`
                        : (isAuthenticated && token && ispId)
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
                  <td>{totalBytesIn.toLocaleString()}</td>
                  <td>{totalBytesOut.toLocaleString()}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
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
                    <td>{formatDate(u.expiryDate)}</td>
                    <td>{u.daysLeft}</td>
                  </tr>
                ))}
                {dueSoon.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center" }}>
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
                  <th>Expired On</th>
                  <th>Days Ago</th>
                </tr>
              </thead>
              <tbody>
                {expired.map((u, i) => (
                  <tr key={`${u.accountNumber}-exp-${i}`}>
                    <td>{u.accountNumber}</td>
                    <td>{u.name}</td>
                    <td>{u.phone}</td>
                    <td>{formatDate(u.expiryDate)}</td>
                    <td>{u.daysAgo}</td>
                  </tr>
                ))}
                {expired.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center" }}>
                      No expired accounts 🎉
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="chart-container">
          <h2>Collections Trend</h2>
          <Chart type="line" data={paymentsChart} />
        </section>
      </div>

      {/* Modals */}
      <ClientsModal isOpen={activeModal === MODALS.CLIENTS} onClose={() => setActiveModal(null)} />
      <PlansModal isOpen={activeModal === MODALS.PLANS} onClose={() => setActiveModal(null)} />
      <PppoeSetupModal isOpen={activeModal === MODALS.PPPOE} onClose={() => setActiveModal(null)} />
      <HotspotSetupModal isOpen={activeModal === MODALS.HOTSPOT} onClose={() => setActiveModal(null)} />
      <PaymentIntegrationModal isOpen={activeModal === MODALS.PAYMENT_INTEGRATION} onClose={() => setActiveModal(null)} />
      <ConnectMikrotikModal isOpen={activeModal === MODALS.MIKROTIK} onClose={() => setActiveModal(null)} />
      <UsageLogsModal isOpen={activeModal === MODALS.USAGE} onClose={() => setActiveModal(null)} />
      <PaymentsModal isOpen={activeModal === MODALS.PAYMENTS} onClose={() => setActiveModal(null)} />

      <MikrotikTerminalModal
        isOpen={activeModal === MODALS.MIKROTIK_TERMINAL}
        onClose={() => setActiveModal(null)}
        authToken={token}
      />
    </div>
  );
}
