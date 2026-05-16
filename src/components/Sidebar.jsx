import "./Sidebar.css";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  MdCable,
  MdClose,
  MdDashboard,
  MdDns,
  MdHistory,
  MdKey,
  MdLan,
  MdLogout,
  MdNotificationsActive,
  MdPayments,
  MdRouter,
  MdSchedule,
  MdSecurity,
  MdSettings,
  MdSms,
  MdSupportAgent,
  MdTerminal,
  MdViewList,
} from "react-icons/md";
import { FaUsers, FaWifi } from "react-icons/fa";
import { RiLinksLine } from "react-icons/ri";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/apiClient";

export default function Sidebar({ open, toggleSidebar }) {
  const navigate = useNavigate();
  const { authMode, ispId, isPlatformAdmin, logout, user } = useAuth();
  const [tenantName, setTenantName] = useState("ISP Billing");

  useEffect(() => {
    let mounted = true;

    async function loadSidebarTitle() {
      if (isPlatformAdmin || authMode === "platform") {
        if (!mounted) return;
        setTenantName("Platform Console");
        return;
      }

      try {
        if (!ispId) return;
        const { data } = await api.get("/tenant/me");
        if (mounted && data?.name) setTenantName(String(data.name));
      } catch {
        if (mounted && user?.displayName) {
          setTenantName(String(user.displayName));
        }
      }
    }

    loadSidebarTitle();
    return () => {
      mounted = false;
    };
  }, [authMode, isPlatformAdmin, ispId, user]);

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      navigate(isPlatformAdmin ? "/login?mode=platform" : "/login", {
        replace: true,
      });
    }
  };

  return (
    <nav className={`sidebar ${open ? "show" : ""}`}>
      <div className="sidebar-header">
        <h2 title={tenantName}>{tenantName}</h2>
        <span
          className="close-btn"
          onClick={toggleSidebar}
          aria-label="Close sidebar"
        >
          <MdClose />
        </span>
      </div>

      <ul>
        {isPlatformAdmin ? (
          <>
            <li>
              <Link to="/platform/gateway-events" onClick={toggleSidebar}>
                <MdPayments /> Orphan Gateway Events
              </Link>
            </li>
            <li>
              <button onClick={handleLogout}>
                <MdLogout /> Logout
              </button>
            </li>
          </>
        ) : (
          <>
            <li>
              <Link to="/" onClick={toggleSidebar}>
                <MdDashboard /> Dashboard
              </Link>
            </li>
            <li>
              <Link to="/routers" onClick={toggleSidebar}>
                <MdRouter /> Routers
              </Link>
            </li>
            <li>
              <Link to="/jobs" onClick={toggleSidebar}>
                <MdSchedule /> Jobs
              </Link>
            </li>
            <li>
              <Link to="/audit-logs" onClick={toggleSidebar}>
                <MdSecurity /> Audit Logs
              </Link>
            </li>
            <li>
              <Link to="/team-access" onClick={toggleSidebar}>
                <FaUsers /> Team Access
              </Link>
            </li>
            <li>
              <Link to="/api-keys" onClick={toggleSidebar}>
                <MdKey /> API Keys
              </Link>
            </li>
            <li>
              <Link to="/communications" onClick={toggleSidebar}>
                <MdSms /> Communications
              </Link>
            </li>
            <li>
              <Link to="/operations-health" onClick={toggleSidebar}>
                <MdSecurity /> Operations Health
              </Link>
            </li>
            <li>
              <Link to="/noc" onClick={toggleSidebar}>
                <MdNotificationsActive /> NOC
              </Link>
            </li>
            <li>
              <Link to="/service-ops" onClick={toggleSidebar}>
                <MdDns /> Service Ops
              </Link>
            </li>
            <li>
              <Link to="/support-ops" onClick={toggleSidebar}>
                <MdSupportAgent /> Support Ops
              </Link>
            </li>
            <li>
              <Link to="/static-ip" onClick={toggleSidebar}>
                <MdSecurity /> Setup Static-IP
              </Link>
            </li>
            <li>
              <Link to="/sms-paylinks" onClick={toggleSidebar}>
                <MdSms /> SMS & Paylinks
              </Link>
            </li>
            <li>
              <Link to="/customers" onClick={toggleSidebar}>
                <FaUsers /> Manage Clients
              </Link>
            </li>
            <li>
              <Link to="/plans" onClick={toggleSidebar}>
                <MdViewList /> Create Plans
              </Link>
            </li>
            <li>
              <Link to="/pppoe" onClick={toggleSidebar}>
                <MdLan /> Configure PPPoE
              </Link>
            </li>
            <li>
              <Link to="/hotspot" onClick={toggleSidebar}>
                <FaWifi /> Manage Hotspot
              </Link>
            </li>
            <li>
              <Link to="/payments" onClick={toggleSidebar}>
                <MdPayments /> Manage Payments
              </Link>
            </li>
            <li>
              <Link to="/payment-settings" onClick={toggleSidebar}>
                <RiLinksLine /> Link Payment Account
              </Link>
            </li>
            <li>
              <Link to="/mikrotik/connect" onClick={toggleSidebar}>
                <MdCable /> Connect To Mikrotik
              </Link>
            </li>
            <li>
              <Link to="/mikrotik/terminal" onClick={toggleSidebar}>
                <MdTerminal /> Mikrotik Terminal
              </Link>
            </li>
            <li>
              <Link to="/usage-logs" onClick={toggleSidebar}>
                <MdHistory /> Usage Logs
              </Link>
            </li>
            <li>
              <Link to="/settings" onClick={toggleSidebar}>
                <MdSettings /> Settings
              </Link>
            </li>
            <li>
              <button onClick={handleLogout}>
                <MdLogout /> Logout
              </button>
            </li>
          </>
        )}
      </ul>
    </nav>
  );
}
