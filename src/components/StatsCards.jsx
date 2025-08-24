import { useEffect, useState } from "react";
import "./StatsCards.css";

export default function StatsCards() {
  const [stats, setStats] = useState({
    totalCustomers: 0,
    activePlans: 0,
    pendingInvoices: 0,
  });

  // Fetch stats from backend
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch("https://isp-billing-uq58.onrender.com/api/stats");
        const data = await res.json();
        setStats(data);
      } catch (err) {
        console.error("Error fetching stats:", err);
      }
    };
    fetchStats();
  }, []);

  return (
    <div className="stats">
      <div className="card">Total Clients: {stats.totalCustomers}</div>
      <div className="card">Active Plans: {stats.activePlans}</div>
      <div className="card">Pending Invoices: {stats.pendingInvoices}</div>
    </div>
  );
}
