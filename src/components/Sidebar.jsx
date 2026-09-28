import "./Sidebar.css";
import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
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
  MdWifiTethering,
} from "react-icons/md";
import { FaUsers, FaWifi } from "react-icons/fa";
import { RiLinksLine } from "react-icons/ri";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/apiClient";

const navigationGroups = [
  {
    label: "Workspace",
    items: [
      { to: "/", label: "Overview", icon: MdDashboard },
      { to: "/customers", label: "Customers", icon: FaUsers },
      { to: "/plans", label: "Plans", icon: MdViewList },
      { to: "/payments", label: "Payments", icon: MdPayments },
      { to: "/finance-recovery", label: "Reconciliation", icon: MdHistory },
      { to: "/sms-paylinks", label: "SMS & paylinks", icon: MdSms },
    ],
  },
  {
    label: "Network",
    items: [
      { to: "/routers", label: "Routers", icon: MdRouter },
      { to: "/pppoe", label: "PPPoE", icon: MdLan },
      { to: "/hotspot", label: "Hotspot", icon: FaWifi },
      { to: "/static-ip", label: "Static IP", icon: MdSecurity },
      { to: "/mikrotik/connect", label: "Connect router", icon: MdCable },
      { to: "/mikrotik/terminal", label: "Terminal", icon: MdTerminal },
      { to: "/usage-logs", label: "Usage", icon: MdHistory },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/operations-health", label: "Operations health", icon: MdSecurity },
      { to: "/noc", label: "NOC", icon: MdNotificationsActive },
      { to: "/service-ops", label: "Service operations", icon: MdDns },
      { to: "/support-ops", label: "Support", icon: MdSupportAgent },
      { to: "/jobs", label: "Jobs", icon: MdSchedule },
      { to: "/communications", label: "Communications", icon: MdSms },
    ],
  },
  {
    label: "Administration",
    items: [
      { to: "/team-access", label: "Team access", icon: FaUsers },
      { to: "/api-keys", label: "API keys", icon: MdKey },
      { to: "/audit-logs", label: "Audit logs", icon: MdSecurity },
      { to: "/payment-settings", label: "Payment integrations", icon: RiLinksLine },
      { to: "/settings", label: "Settings", icon: MdSettings },
    ],
  },
];

function initialsFor(user) {
  const source = user?.displayName || user?.username || user?.email || "Operator";
  return String(source)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "OP";
}

export default function Sidebar({ open, toggleSidebar }) {
  const navigate = useNavigate();
  const { authMode, ispId, isPlatformAdmin, logout, role, user } = useAuth();
  const [tenantName, setTenantName] = useState("ISP workspace");

  useEffect(() => {
    let mounted = true;

    async function loadSidebarTitle() {
      if (isPlatformAdmin || authMode === "platform") {
        if (mounted) setTenantName("Platform operations");
        return;
      }

      try {
        if (!ispId) return;
        const { data } = await api.get("/tenant/me");
        if (mounted && data?.name) setTenantName(String(data.name));
      } catch {
        if (mounted && user?.displayName) setTenantName(String(user.displayName));
      }
    }

    loadSidebarTitle();
    return () => {
      mounted = false;
    };
  }, [authMode, isPlatformAdmin, ispId, user]);

  const operatorName = user?.displayName || user?.username || user?.email || "Operator";
  const operatorRole = useMemo(
    () => String(role || (isPlatformAdmin ? "Platform admin" : "Team member")).replace(/-/g, " "),
    [isPlatformAdmin, role]
  );

  const handleNavigate = () => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      toggleSidebar();
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      navigate(isPlatformAdmin ? "/login?mode=platform" : "/login", { replace: true });
    }
  };

  const navClassName = ({ isActive }) => `sidebar-link${isActive ? " active" : ""}`;

  return (
    <aside className={`sidebar ${open ? "show" : ""}`} aria-label="Application navigation">
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark" aria-hidden="true"><MdWifiTethering /></span>
          <span className="sidebar-brand-copy">
            <strong>SwiftBridge</strong>
            <small title={tenantName}>{tenantName}</small>
          </span>
        </div>
        <button className="sidebar-close" onClick={toggleSidebar} aria-label="Close navigation">
          <MdClose />
        </button>
      </div>

      <div className="sidebar-scroll">
        {isPlatformAdmin ? (
          <section className="sidebar-group" aria-labelledby="platform-navigation">
            <h2 id="platform-navigation">Platform</h2>
            <NavLink className={navClassName} to="/platform/gateway-events" onClick={handleNavigate}>
              <MdPayments />
              <span>Gateway events</span>
            </NavLink>
          </section>
        ) : (
          navigationGroups.map((group) => (
            <section
              className="sidebar-group"
              key={group.label}
              aria-labelledby={`nav-${group.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <h2 id={`nav-${group.label.toLowerCase().replace(/\s+/g, "-")}`}>{group.label}</h2>
              <div className="sidebar-group-links">
                {group.items.map(({ to, label, icon: Icon }) => (
                  <NavLink className={navClassName} to={to} end={to === "/"} onClick={handleNavigate} key={to}>
                    <Icon />
                    <span>{label}</span>
                  </NavLink>
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-operator">
          <span className="sidebar-avatar">{initialsFor(user)}</span>
          <span>
            <strong title={operatorName}>{operatorName}</strong>
            <small>{operatorRole}</small>
          </span>
        </div>
        <button className="sidebar-logout" onClick={handleLogout} aria-label="Sign out">
          <MdLogout />
        </button>
      </div>
    </aside>
  );
}
