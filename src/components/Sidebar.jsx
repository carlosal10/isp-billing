import './Sidebar.css';
import MODALS from "../constants/modals";
import { Link } from "react-router-dom";

export default function Sidebar({ open, toggleSidebar, onOpenModal }) {
  return (
    <nav className={`sidebar ${open ? "show" : ""}`}>
      <div className="sidebar-header">
        <h2>ISP Billing</h2>
        <span className="close-btn" onClick={toggleSidebar}>X</span>
      </div>
      <ul>
        <li><Link to="/">Dashboard</Link></li>
        <li><button onClick={() => onOpenModal(MODALS.CLIENTS)}>Clients</button></li>
        <li><button onClick={() => onOpenModal(MODALS.PLANS)}>Subscription Plans</button></li>
        <li><button onClick={() => onOpenModal(MODALS.PPPOE)}>PPPoE Setup</button></li>
        <li><button onClick={() => onOpenModal(MODALS.HOTSPOT)}>Hotspot Setup</button></li>
        <li><button onClick={() => onOpenModal(MODALS.PAYMENTS)}>Payments</button></li>
        <li><button onClick={() => onOpenModal(MODALS.PAYMENT_INTEGRATION)}>Link Payment Account</button></li>
        <li><button onClick={() => onOpenModal(MODALS.MIKROTIK)}>Connect To Mikrotik</button></li>
        <li><button onClick={() => onOpenModal(MODALS.MIKROTIK_TERMINAL)}>Mikrotik Terminal</button></li>
        <li><button onClick={() => onOpenModal(MODALS.USAGE)}>Usage Logs</button></li>
        <li><a href="/logout">Logout</a></li>
      </ul>
    </nav>
  );
}
