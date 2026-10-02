import React, { useEffect, useState } from 'react';
import { api } from '../lib/apiClient';
import { Field } from './ui/Field';

export default function ProviderReconciliation() {
  const [statements, setStatements] = useState([]), [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [provider, setProvider] = useState('mpesa'), [start, setStart] = useState(''), [end, setEnd] = useState(''), [text, setText] = useState('');
  const [selected, setSelected] = useState(null), [reason, setReason] = useState('');
  async function list() { setStatements((await api.get('/finance/statements')).data); }
  useEffect(() => { list().catch(() => setError('Could not load statements. Refresh to retry.')); }, []);
  async function run(work) { setBusy(true); setError(''); try { await work(); } catch (err) { setError(err.response?.data?.error || err.message || 'The statement could not be processed.'); } finally { setBusy(false); } }
  async function open(id) { setReport((await api.get(`/finance/statements/${id}`)).data); setSelected(null); }
  function importRows(event) {
    event.preventDefault();
    run(async () => {
      const lines = text.trim() ? text.trim().split(/\r?\n/) : [];
      const rows = lines.map((line, index) => {
        const cells = line.split(',').map(cell => cell.trim());
        if (cells.length !== 4) throw new Error(`Row ${index + 1}: use reference, amount, currency, timestamp.`);
        const [reference, amount, currency, occurredAt] = cells;
        return { reference, amount: Number(amount), currency, occurredAt };
      });
      const { data } = await api.post('/finance/statements', { provider, start: `${start}T00:00:00Z`, end: `${end}T00:00:00Z`, rows });
      await list(); await open(data._id);
    });
  }
  return <section className="workspace-card" aria-labelledby="provider-statement-title">
    <h2 id="provider-statement-title">Provider statements</h2>
    <p>Compare gross successful receipts with recorded payments, before provider fees. Use UTC dates and an exclusive end date. Refunds and chargebacks remain visible in payment history.</p>
    {error && <div role="alert" className="notice error">{error}</div>}
    <details className="statement-import"><summary>Import a statement</summary>
      <form onSubmit={importRows} className="statement-form">
        <div className="form-grid">
          <Field label="Provider"><select value={provider} onChange={e => setProvider(e.target.value)}><option value="mpesa">M-Pesa</option><option value="stripe">Stripe</option><option value="paypal">PayPal</option></select></Field>
          <Field label="Period start (UTC)"><input type="date" required value={start} onChange={e => setStart(e.target.value)} /></Field>
          <Field label="Period end (UTC, exclusive)"><input type="date" required value={end} onChange={e => setEnd(e.target.value)} /></Field>
        </div>
        <Field label="Receipt rows" hint="One row per receipt: reference, amount, currency, ISO timestamp. No header. Up to 2,000 rows; leave empty for a statement with no receipts."><textarea rows={5} value={text} onChange={e => setText(e.target.value)} placeholder="RECEIPT123, 2500.00, KES, 2026-09-01T09:00:00Z" /></Field>
        <div className="form-actions"><button type="submit" disabled={busy}>{busy ? 'Working…' : 'Import and compare'}</button></div>
      </form>
    </details>
    <Field label="Saved statement"><select value={report?._id || ''} disabled={busy} onChange={e => e.target.value && run(() => open(e.target.value))}><option value="">Choose a statement</option>{statements.map(s => <option key={s._id} value={s._id}>{s.provider.toUpperCase()} · {s.start.slice(0, 10)} to {s.end.slice(0, 10)}</option>)}</select></Field>
    {report && <div className="statement-result">
      <div className="workspace-header"><div><h3>Comparison results</h3><p role="status">{report.unresolved} unresolved discrepancies. Acknowledgements retain the discrepancy and its explanation.</p></div><button className="secondary" disabled={busy} onClick={() => run(() => open(report._id))}>Recompare</button></div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Financial records"><table><caption className="sr-only">Provider and internal receipt totals</caption><thead><tr><th>Currency</th><th>Provider</th><th>Recorded</th><th>Difference</th></tr></thead><tbody>{report.totals.map(r => <tr key={r.currency}><td>{r.currency}</td><td>{r.provider.toFixed(2)}</td><td>{r.internal.toFixed(2)}</td><td>{r.difference.toFixed(2)}</td></tr>)}</tbody></table></div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Financial records"><table><caption className="sr-only">Receipt comparison</caption><thead><tr><th>Reference</th><th>Status</th><th>Provider amount</th><th>Recorded amount</th><th>Resolution</th></tr></thead><tbody>{report.rows.map(r => <tr key={r.key}><td>{r.reference}</td><td>{r.status.replaceAll('-', ' ')}</td><td>{r.external.map(x => `${x.currency} ${x.amount.toFixed(2)}`).join(', ') || '—'}</td><td>{r.payments.map(x => `${x.currency} ${x.amount.toFixed(2)}`).join(', ') || '—'}</td><td>{r.acknowledgement ? r.acknowledgement.reason : r.status !== 'matched' ? <button className="secondary" disabled={busy} onClick={() => { setSelected(r.key); setReason(''); }}>Record investigation</button> : 'Matched'}</td></tr>)}</tbody></table></div>
      {selected && <form className="statement-form" onSubmit={e => { e.preventDefault(); run(async () => { await api.post(`/finance/statements/${report._id}/acknowledge`, { key: selected, reason }); await open(report._id); }); }}>
        <Field label="Investigation outcome" hint="Explain the discrepancy and reference any corrective payment or provider action. This does not change financial records."><textarea required minLength={5} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></Field>
        <div className="form-actions"><button disabled={busy} type="submit">Save investigation</button><button className="secondary" type="button" onClick={() => setSelected(null)}>Cancel</button></div>
      </form>}
    </div>}
  </section>;
}
