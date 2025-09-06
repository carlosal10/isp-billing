import React, { useState, useEffect, useCallback } from "react";
import { Line, Bar } from "react-chartjs-2";
import { FaDownload, FaTimes } from "react-icons/fa";
import { api } from "../lib/apiClient";
import 'chart.js/auto';
import "./UsageModal.css";

const Button = ({ children, className = "", ...props }) => (
  <button
    {...props}
    className={className}
    style={{ padding: "6px 10px", background: "#111827", color: "#fff", borderRadius: 6 }}
  >
    {children}
  </button>
);
const Card = ({ children, className }) => (
  <div className={`card ${className || ""}`} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
    {children}
  </div>
);
const CardContent = ({ children, className = "" }) => <div className={`card-content ${className}`}>{children}</div>;

// Converted from modal overlay to bottom panel that's part of the page
const UsageModal = ({ isOpen, onClose }) => {
  const [usageTrends, setUsageTrends] = useState([]);
  const [activeUsers, setActiveUsers] = useState([]);
  const [usageLogs, setUsageLogs] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [statusMsg, setStatusMsg] = useState("");

  const fetchData = useCallback(async () => {
    try {
      // Record a snapshot for today (tenant-scoped on server)
      try {
        await api.post("/usageLogs/record");
        setStatusMsg("");
      } catch (e) {
        setStatusMsg("Waking API ... retrying in 2s");
        setTimeout(() => {
          fetchData();
        }, 2000);
        return;
      }

      const { data } = await api.get("/usageLogs/daily", { params: { days: 14 } });
      const items = data?.items || [];
      setUsageTrends(items.map((x) => ({ date: x.date, usagePerUser: x.activeUsersCount })));
      setActiveUsers(items.map((x) => ({ date: x.date, activeUsersCount: x.activeUsersCount })));

      // Optional: keep old tables with placeholders
      setUsageLogs([]);
      setInvoices([]);
    } catch (err) {
      console.error("Failed to fetch usage data", err);
      setStatusMsg(err?.message || "Failed to load usage");
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen, fetchData]);

  // Prepare chart data
  const usageTrendsData = {
    labels: usageTrends.map(d => new Date(d.date).toLocaleDateString()),
    datasets: [
      {
        label: "Bandwidth Usage (GB)",
        data: usageTrends.map(d => d.usagePerUser),
        borderColor: "rgba(75,192,192,1)",
        borderWidth: 2,
      },
    ],
  };

  const activeUsersData = {
    labels: activeUsers.map(d => new Date(d.date).toLocaleDateString()),
    datasets: [
      {
        label: "Active Users",
        data: activeUsers.map(d => d.activeUsersCount),
        backgroundColor: "rgba(54,162,235,0.5)",
      },
    ],
  };

  if (!isOpen) return null;

  return (
    <div className="usage-panel open">
      <div className="usage-panel-header">
        <h2>Usage Logs & Reports</h2>
        <button onClick={onClose} aria-label="Close usage panel" className="icon-button">
          <FaTimes size={18} />
        </button>
      </div>

      {statusMsg && (
        <div className="usage-panel-status">{statusMsg}</div>
      )}

      <div className="usage-panel-body">
        <Card className="mb-4">
          <CardContent>
            <h3 className="section-title">PPPoE Usage Trends</h3>
            <Line data={usageTrendsData} />
          </CardContent>
        </Card>

        <Card className="mb-4">
          <CardContent>
            <h3 className="section-title">Active PPPoE Users (Daily)</h3>
            <Bar data={activeUsersData} />
          </CardContent>
        </Card>

        <Card className="mb-4 overflow-x-auto">
          <CardContent>
            <h3 className="section-title">Usage Logs</h3>
            <table className="w-full text-left border">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2">#</th>
                  <th className="p-2">User</th>
                  <th className="p-2">Date</th>
                  <th className="p-2">Bytes In</th>
                  <th className="p-2">Bytes Out</th>
                </tr>
              </thead>
              <tbody>
                {usageLogs.map((log, idx) => (
                  <tr key={log._id || idx} className="border-t">
                    <td className="p-2">{idx + 1}</td>
                    <td className="p-2">{log.user}</td>
                    <td className="p-2">{new Date(log.date).toLocaleDateString()}</td>
                    <td className="p-2">{log.in}</td>
                    <td className="p-2">{log.out}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="mb-4 overflow-x-auto">
          <CardContent>
            <h3 className="section-title">Invoices</h3>
            <table className="w-full text-left border">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2">#</th>
                  <th className="p-2">Customer</th>
                  <th className="p-2">Amount</th>
                  <th className="p-2">Date</th>
                  <th className="p-2">Download</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv, idx) => (
                  <tr key={inv._id || idx} className="border-t">
                    <td className="p-2">{idx + 1}</td>
                    <td className="p-2">{inv.customer}</td>
                    <td className="p-2">{inv.amount}</td>
                    <td className="p-2">{new Date(inv.date).toLocaleDateString()}</td>
                    <td className="p-2">
                      <Button className="flex items-center gap-2">
                        <FaDownload /> PDF
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default UsageModal;


