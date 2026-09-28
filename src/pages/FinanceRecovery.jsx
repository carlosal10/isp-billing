import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/apiClient';
import { Field } from '../components/ui/Field';
import { useAuth } from '../context/AuthContext';

export default function FinanceRecovery() {
  const { role } = useAuth();
  const [report, setReport] = useState(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [selection, setSelection] = useState(null), [reason, setReason] = useState('');
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try { setReport((await api.get('/finance/reconciliation')).data); }
    catch (err) { setError(err.response?.data?.error || 'Could not load reconciliation. Try again.'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { if (['owner', 'admin'].includes(role)) load(); }, [load, role]);
  async function recover(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api.post(`/finance/recovery/${selection.kind}/${selection.id}`, { reason }); setSelection(null); setReason(''); await load(); }
    catch (err) { setError(err.response?.data?.error || 'Recovery failed. The item remains available to retry.'); setBusy(false); }
  }
  if (!['owner', 'admin'].includes(role)) return <main className="workspace-page"><h1>Finance recovery</h1><p>Owner or administrator access is required.</p></main>;
  return <main className="workspace-page">
    <header className="workspace-header"><div><span className="eyebrow">BILLING OPERATIONS</span><h1>Reconciliation & recovery</h1><p>Check ledger balance and follow up on payments or service changes that need attention.</p></div><button className="secondary" onClick={load} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button></header>
    {error && <div role="alert" className="notice error">{error}</div>}
    {!report && !error && <p role="status">Loading finance health…</p>}
    {report && <>
      <section className="recovery-metrics" aria-label="Finance health">
        <article><span>Payments to recover</span><strong>{report.settledUnapplied.length}</strong><p>Received but awaiting ledger settlement</p></article>
        <article><span>Gateway exceptions</span><strong>{report.unmatchedEvents}</strong><Link to="/payments">Review payment events →</Link></article>
        <article><span>Service updates</span><strong>{report.accessJobs.length}</strong><p>Pending, retrying, or needing intervention</p></article>
      </section>
      <section className="workspace-card"><h2>Ledger balance</h2><p>Debits and credits must match for each currency. Provider statement reconciliation is a separate release check.</p>
        {report.ledger.length ? <div className="table-scroll"><table><thead><tr><th>Currency</th><th>Debits</th><th>Credits</th><th>Difference</th></tr></thead><tbody>{report.ledger.map(row => <tr key={row.currency}><td>{row.currency}</td><td>{row.debit.toFixed(2)}</td><td>{row.credit.toFixed(2)}</td><td><span className={row.difference ? 'status-badge danger' : 'status-badge'}>{row.difference.toFixed(2)}</span></td></tr>)}</tbody></table></div> : <p>No ledger entries yet.</p>}
      </section>
      <section className="workspace-card"><h2>Payment settlement</h2>{report.settledUnapplied.length ? <div className="table-scroll"><table><thead><tr><th>Account</th><th>Amount</th><th>Reference</th><th>Action</th></tr></thead><tbody>{report.settledUnapplied.map(row => <tr key={row._id}><td>{row.accountNumber}</td><td>{row.currency} {row.amount.toFixed(2)}</td><td>{row.transactionId || 'Manual'}</td><td><button className="secondary" onClick={() => setSelection({ kind: 'payment', id: row._id })}>Recover settlement</button></td></tr>)}</tbody></table></div> : <p className="empty-state">No unsettled payments need recovery.</p>}</section>
      <section className="workspace-card"><h2>Service activation queue</h2><p>Payment records stay settled while router updates retry. The worker processes queued updates every minute.</p>{report.accessJobs.length ? <div className="table-scroll"><table><thead><tr><th>Customer</th><th>Status</th><th>Attempts</th><th>Details</th><th>Action</th></tr></thead><tbody>{report.accessJobs.map(row => <tr key={row._id}><td>{row.customerId?.name || row.customerId?.accountNumber || 'Customer'}</td><td>{row.status}</td><td>{row.attempts}</td><td>{row.lastError || 'Waiting for synchronization'}</td><td><button className="secondary" disabled={row.status === 'processing'} onClick={() => setSelection({ kind: 'access', id: row._id })}>Queue retry</button></td></tr>)}</tbody></table></div> : <p className="empty-state">All service updates are complete.</p>}</section>
      {selection && <section className="workspace-card"><h2>Confirm recovery</h2><form onSubmit={recover}><Field label="Reason" hint="This explanation is recorded in the audit log."><textarea autoFocus required minLength={5} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></Field><div className="form-actions"><button type="submit" disabled={busy}>Confirm recovery</button><button type="button" className="secondary" onClick={() => setSelection(null)}>Cancel</button></div></form></section>}
      <p className="muted-inline">Updated {new Date(report.generatedAt).toLocaleString()} · Lists show up to {report.limit} items.</p>
    </>}
  </main>;
}
