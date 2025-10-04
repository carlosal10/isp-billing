import './Sidebar.css';
import MODALS from "../constants/modals";
import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/apiClient";

// Icons
import { MdDashboard, MdLogout, MdPayments, MdTerminal, MdSettings, MdViewList, MdLan, MdHistory, MdCable, MdClose, MdSms, MdSecurity, MdRouter } from "react-icons/md";
import { FaUsers, FaWifi } from "react-icons/fa";
import { RiLinksLine } from "react-icons/ri";

export default function Sidebar({ open, toggleSidebar, onOpenModal }) {
  const navigate = useNavigate();
  const { logout, ispId, user } = useAuth();
  const [tenantName, setTenantName] = useState('ISP Billing');

  useEffect(() => {
    let mounted = true;
    async function loadTenant() {
      try {
        if (!ispId) return;
        const { data } = await api.get('/tenant/me');
        if (mounted && data?.name) setTenantName(String(data.name));
      } catch {
        // Fallbacks if API not available
        if (mounted && user?.displayName) setTenantName(String(user.displayName));
      }
    }
    loadTenant();
    return () => { mounted = false; };
  }, [ispId, user]);

  const handleLogout = async () => {
    try { await logout(); } finally { navigate('/login', { replace: true }); }
  };

  return (
    <nav className={`sidebar ${open ? "show" : ""}`}>
      <div className="sidebar-header">
        <h2 title={tenantName}>{tenantName}</h2>
        <span className="close-btn" onClick={toggleSidebar} aria-label="Close sidebar"><MdClose /></span>
      </div>
      <ul>
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
          <button onClick={() => onOpenModal(MODALS.STATIC_SETUP)}>
            <MdSecurity /> Setup Static-IP
          </button>
        </li>
        <li>
          <button onClick={() => onOpenModal(MODALS.SMS_SETTINGS)}>
            <MdSms /> SMS & Paylinks
          </button>
        </li>
        <li>
          <button onClick={() => onOpenModal(MODALS.CLIENTS)}>
            <FaUsers /> Manage Clients
          </button>
        </li>
        <li>
          <button onClick={() => onOpenModal(MODALS.PLANS)}>
            <MdViewList /> Create Plans
          </button>
        </li>
        <li>
          <button onClick={() => onOpenModal(MODALS.PPPOE)}>
            <MdLan /> Configure PPPoE
          </button>
        </li>
        <li>
          <button onClick={() => onOpenModal(MODALS.HOTSPOT)}>
            <FaWifi /> Manage Hotspot
          </button>
        </li>
        <li>
          <button onClick={() => onOpenModal(MODALS.PAYMENTS)}>
            <MdPayments /> Manage Payments
          </button>
        </li>
        <li>
          <button onClick={() => onOpenModal(MODALS.PAYMENT_INTEGRATION)}>
            <RiLinksLine /> Link Payment Account
          </button>
        </li>
        <li>
          <button onClick={() => onOpenModal(MODALS.MIKROTIK)}>
            <MdCable /> Connect To Mikrotik
          </button>
        </li>
        <li>
          <button onClick={() => onOpenModal(MODALS.MIKROTIK_TERMINAL)}>
            <MdTerminal /> Mikrotik Terminal
          </button>
        </li>
        <li>
          <button onClick={() => onOpenModal(MODALS.USAGE)}>
            <MdHistory /> Usage Logs
          </button>
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
      </ul>
    </nav>
  );
}




