import React, { useState } from "react";
import { Modal } from "../components/ui/Modal";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { Line, Bar } from "react-chartjs-2";
import { FaDownload, FaTimes } from "react-icons/fa";

const UsageModal = ({ isOpen, onClose }) => {
  // Mock chart data
  const usageTrendsData = {
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    datasets: [
      {
        label: "Bandwidth Usage (GB)",
        data: [10, 15, 8, 12, 20, 18, 25],
        borderWidth: 2,
      },
    ],
  };

  const activeUsersData = {
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    datasets: [
      {
        label: "Active Users",
        data: [30, 40, 35, 50, 45, 60, 70],
        backgroundColor: "rgba(54,162,235,0.5)",
      },
    ],
  };

  // Mock logs
  const usageLogs = [
    { id: 1, user: "John Doe", date: "2025-08-21", in: "2GB", out: "1GB" },
    { id: 2, user: "Jane Doe", date: "2025-08-22", in: "3GB", out: "2GB" },
  ];

  const invoices = [
    { id: 1, customer: "John Doe", amount: "KES 1000", date: "2025-08-20" },
    { id: 2, customer: "Jane Doe", amount: "KES 2000", date: "2025-08-21" },
  ];

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

      {/* Reports */}
      <Card className="mb-4">
        <CardContent>
          <h3 className="text-lg font-semibold mb-2">Reports</h3>
          <Button className="flex items-center gap-2">
            <FaDownload /> Download Usage Report
          </Button>
        </CardContent>
      </Card>

      {/* Usage Logs */}
      <Card className="mb-4">
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
              {usageLogs.map((log) => (
                <tr key={log.id} className="border-t">
                  <td className="p-2">{log.id}</td>
                  <td className="p-2">{log.user}</td>
                  <td className="p-2">{log.date}</td>
                  <td className="p-2">{log.in}</td>
                  <td className="p-2">{log.out}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Invoices */}
      <Card className="mb-4">
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
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="border-t">
                  <td className="p-2">{invoice.id}</td>
                  <td className="p-2">{invoice.customer}</td>
                  <td className="p-2">{invoice.amount}</td>
                  <td className="p-2">{invoice.date}</td>
                  <td className="p-2">
                    <Button size="sm" className="flex items-center gap-2">
                      <FaDownload /> PDF
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button className="mt-3 flex items-center gap-2">
            <FaDownload /> Download Invoice Report
          </Button>
        </CardContent>
      </Card>
    </Modal>
  );
};

export default UsageModal;
