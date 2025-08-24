import React, { useState, useEffect } from "react";
import { Modal } from "../components/ui/Modal";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { Line, Bar } from "react-chartjs-2";
import { FaDownload, FaTimes } from "react-icons/fa";
import axios from "axios";
import 'chart.js/auto';
import "./UsageModal.css"; // ✅ custom styles

const UsageModal = ({ isOpen, onClose }) => {
  const [usageTrends, setUsageTrends] = useState([]);
  const [activeUsers, setActiveUsers] = useState([]);
  const [usageLogs, setUsageLogs] = useState([]);
  const [invoices, setInvoices] = useState([]);

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen]);

  const fetchData = async () => {
    try {
      const [trendsRes, activeRes, logsRes, invoicesRes] = await Promise.all([
        axios.get("https://isp-billing-uq58.onrender.com/pppoe/stats/usage-trends"),
        axios.get("https://isp-billing-uq58.onrender.com/pppoe/stats/active-daily"),
        axios.get("https://isp-billing-uq58.onrender.com/pppoe/logs"),
        axios.get("https://isp-billing-uq58.onrender.com/pppoe/invoices"),
      ]);

      setUsageTrends(trendsRes.data);
      setActiveUsers(activeRes.data);
      setUsageLogs(logsRes.data);
      setInvoices(invoicesRes.data);
    } catch (err) {
      console.error("Failed to fetch data", err);
    }
  };

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
