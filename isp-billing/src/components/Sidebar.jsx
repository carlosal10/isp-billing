export default function Sidebar({ open, toggleSidebar, onOpenModal }) {
  return (
    <nav className={`sidebar ${open ? "show" : ""}`}>
      <div className="sidebar-header">
        <h2>ISP Billing</h2>
        <span className="close-btn" onClick={toggleSidebar}>
          X
        </span>
      </div>
      <ul>
        <li><a href="/dashboard">Dashboard</a></li>
        <li><button onClick={() => onOpenModal("clients")}>Clients</button></li>
        <li><button onClick={() => onOpenModal("plans")}>Subscription Plans</button></li>
        <li><button onClick={() => onOpenModal("pppoe")}>PPPoE Setup</button></li>
        <li><button onClick={() => onOpenModal("hotspot")}>Hotspot Setup</button></li>
        <li><a href="/invoices">Invoices</a></li>
        <li><a href="/payments">Payments</a></li>
        <li><button onClick={() => onOpenModal("payments")}>Link Payment Account</button></li>
        <li><button onClick={() => onOpenModal("mikrotik")}>Connect To Mikrotik</button></li>
        <li><button onClick={() => onOpenModal("usage")}>Usage Logs</button></li>
        <li><a href="/logout">Logout</a></li>
      </ul>
    </nav>
  );
}
