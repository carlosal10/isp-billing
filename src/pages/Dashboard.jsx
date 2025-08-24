import React, { useState, useEffect } from "react";
import { Chart } from "react-chartjs-2";
import "chart.js/auto";
import "./Dashboard.css";

import Sidebar from "../components/Sidebar";
import StatsCards from "../components/StatsCards";
import MODALS from "../constants/modals";

// import all modals
import ClientsModal from "../components/CustomersModal";
import PlansModal from "../components/PlanModal";
import PppoeSetupModal from "../components/PppoeModal";
import HotspotSetupModal from "../components/HotspotModal";
import PaymentIntegrationModal from "../components/PaymentSetting";
import ConnectMikrotikModal from "../components/ConnectMikrotik";
import UsageLogsModal from "../components/UsageModal";
import PaymentsModal from "../components/PaymentsModal";

export default function Dashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [pppoeUsers, setPppoeUsers] = useState([]);
  const [showExpired, setShowExpired] = useState(false);
  const [activeModal, setActiveModal] = useState(null);

  const [stats, setStats] = useState({
    totalCustomers: 0,
    activePlans: 0,
    pendingInvoices: 0,
  });

  useEffect(() => {
    fetch("https://isp-billing-uq58.onrender.com/api/stats")
      .then((res) => res.json())
      .then((data) => setStats(data))
      .catch(() => {});
  }, []);

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  const chartData = {
    labels: ["Jan", "Feb", "Mar", "Apr"],
    datasets: [
      {
        label: "Usage (MB)",
        data: [100, 200, 150, 300],
        borderColor: "blue",
        backgroundColor: "rgba(0, 0, 255, 0.3)",
      },
    ],
  };

  return (
    <div className="dashboard">
      {/* Hamburger menu */}
      <div className="hamburger" onClick={toggleSidebar}>
        ☰
      </div>

      {/* Sidebar */}
      <Sidebar
        open={sidebarOpen}
        toggleSidebar={toggleSidebar}
        onOpenModal={setActiveModal}
      />

      {/* Main Content */}
      <div className="main-content">
        <h1>Welcome</h1>
        <StatsCards stats={stats} />

        {/* PPPoE Users */}
        <section className="pppoe-status-section">
          <h2>Online PPPoE Users</h2>
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>IP Address</th>
                <th>Uptime</th>
                <th>Bytes In</th>
                <th>Bytes Out</th>
              </tr>
            </thead>
            <tbody>
              {pppoeUsers.map((u, i) => (
                <tr key={i}>
                  <td>{u.username}</td>
                  <td>{u.ip}</td>
                  <td>{u.uptime}</td>
                  <td>{u.bytesIn}</td>
                  <td>{u.bytesOut}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Controls */}
        <div className="pppoe-usage-controls">
          <label>
            <input
              type="checkbox"
              checked={showExpired}
              onChange={() => setShowExpired(!showExpired)}
            />
            Show Expired/Disabled Users
          </label>
        </div>

        {/* Usage Summary */}
        <div className="pppoe-usage-stats">
          <h2>Usage Summary</h2>
          <div className="usage-box">
            <div>
              Total Bytes In: {pppoeUsers.reduce((a, u) => a + u.bytesIn, 0)}
            </div>
            <div>
              Total Bytes Out: {pppoeUsers.reduce((a, u) => a + u.bytesOut, 0)}
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="chart-container">
          <Chart type="line" data={chartData} />
        </div>
      </div>

      {/* Modals */}
      <ClientsModal
        isOpen={activeModal === MODALS.CLIENTS}
        onClose={() => setActiveModal(null)}
      />
      <PlansModal
        isOpen={activeModal === MODALS.PLANS}
        onClose={() => setActiveModal(null)}
      />
      <PppoeSetupModal
        isOpen={activeModal === MODALS.PPPOE}
        onClose={() => setActiveModal(null)}
      />
      <HotspotSetupModal
        isOpen={activeModal === MODALS.HOTSPOT}
        onClose={() => setActiveModal(null)}
      />
      <PaymentIntegrationModal
        isOpen={activeModal === MODALS.PAYMENT_INTEGRATION}
        onClose={() => setActiveModal(null)}
      />
      <ConnectMikrotikModal
        isOpen={activeModal === MODALS.MIKROTIK}
        onClose={() => setActiveModal(null)}
      />
      <UsageLogsModal
        isOpen={activeModal === MODALS.USAGE}
        onClose={() => setActiveModal(null)}
      />
      <PaymentsModal
        isOpen={activeModal === MODALS.PAYMENTS}
        onClose={() => setActiveModal(null)}
      />
    </div>
  );
}
