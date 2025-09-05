import React, { useState, useEffect, useCallback } from "react";
import { Line, Bar } from "react-chartjs-2";
import { FaDownload, FaTimes } from "react-icons/fa";
import { api } from "../lib/apiClient";
import 'chart.js/auto';
import "./UsageModal.css";

// Fallback minimal wrappers in case UI kit is absent
const Modal = ({ isOpen, onClose, children }) =>
  !isOpen ? null : (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999 }}>
      <div style={{ background: "#fff", margin: "40px auto", padding: 16, borderRadius: 12, maxWidth: 900 }}>
        {children}
      </div>
    </div>
  );
const Button = ({ children, ...props }) => (
  <button {...props} style={{ padding: "6px 10px", background: "#111827", color: "#fff", borderRadius: 6 }}>
    {children}
  </button>
);
const Card = ({ children, className }) => (
  <div className={className} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>{children}</div>
);
const CardContent = ({ children }) => <div>{children}</div>;

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

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Usage Logs & Reports</h2>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
          <FaTimes size={20} />
        </button>
      </div>

      {statusMsg && (
        <div style={{ marginBottom: 8, color: "#6b7280" }}>{statusMsg}</div>
      )}

      {/* Charts */}
      <Card className="mb-4">
        <CardContent>
          <h3 className="text-lg font-semibold mb-2">PPPoE Usage Trends</h3>
          <Line data={usageTrendsData} />
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent>
          <h3 className="text-lg font-semibold mb-2">Active PPPoE Users (Daily)</h3>
          <Bar data={activeUsersData} />
        </CardContent>
      </Card>

      {/* Usage Logs */}
      <Card className="mb-4 overflow-x-auto">
        <CardContent>
          <h3 className="text-lg font-semibold mb-2">Usage Logs</h3>
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

      {/* Invoices */}
      <Card className="mb-4 overflow-x-auto">
        <CardContent>
          <h3 className="text-lg font-semibold mb-2">Invoices</h3>
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
                    <Button size="sm" className="flex items-center gap-2">
                      <FaDownload /> PDF
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </Modal>
  );
};

export default UsageModal;


