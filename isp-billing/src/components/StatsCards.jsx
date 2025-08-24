export default function StatsCards({ stats }) {
  return (
    <div className="stats">
      <div className="card">Total Clients: {stats.totalCustomers}</div>
      <div className="card">Active Plans: {stats.activePlans}</div>
      <div className="card">Pending Invoices: {stats.pendingInvoices}</div>
    </div>
  );
}
