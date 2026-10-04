import React, { useEffect, useState } from 'react';
import { api } from '../lib/apiClient';
import { Field } from './ui/Field';
import { Modal } from './ui/Modal';
import './FupPanel.css';

function bytesToGb(value) { const n=BigInt(value || '0'); const fraction=(n%1000000000n).toString().padStart(9,'0').replace(/0+$/, ''); return (n/1000000000n).toString() + (fraction ? '.'+fraction : ''); }
function gbToBytes(value) { const match=/^(\d+)(?:\.(\d{0,9}))?$/.exec(value); return match ? (BigInt(match[1])*1000000000n + BigInt((match[2]||'').padEnd(9,'0'))).toString() : '0'; }
const initial = { name: '', includedBytes: '50000000000', period: 'monthly', measurement: 'combined', warningPercent: 80, throttlePercent: 100, throttleDownload: '2M', throttleUpload: '512K', hardBlockPercent: null, resetTimezone: 'Africa/Nairobi', enabled: true };
const formatBytes = value => {
  const n = BigInt(value || '0');
  return (n / 1000000000n).toString() + '.' + ((n % 1000000000n) / 10000000n).toString().padStart(2, '0') + ' GB';
};
export default function FupPanel({ canManage }) {
  const [policies, setPolicies] = useState([]), [items, setItems] = useState([]), [notices, setNotices] = useState([]);
  const [next, setNext] = useState(null), [editing, setEditing] = useState(null), [override, setOverride] = useState(null);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  async function load(cursor) {
    const [p, s] = await Promise.all([api.get('/network/fup-policies'), api.get('/network/fup-policies/status', { params: cursor ? { after: cursor } : {} })]);
    setPolicies(p.data.items); setItems(old => cursor ? [...old, ...s.data.assignments] : s.data.assignments);
    setNotices(s.data.notices); setNext(s.data.nextCursor);
  }
  useEffect(() => { let active = true; load().catch(() => { if (active) setError('Unable to load fair usage policies.'); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  async function act(work, text) {
    setBusy(true); setError(''); setMessage('');
    try { await work(); await load(); setMessage(text); }
    catch (e) { setError(e.response?.data?.error || e.message || 'Request failed.'); }
    finally { setBusy(false); }
  }
  async function save(event) {
    event.preventDefault();
    const { _id, ...body } = editing;
    await act(async () => {
      if (_id) await api.patch('/network/fup-policies/' + _id, body); else await api.post('/network/fup-policies', body);
      setEditing(null);
    }, 'Policy saved. Enforcement is evaluated every five minutes.');
  }
  const update = (key, value) => setEditing(old => ({ ...old, [key]: value }));
  return <section className="workspace-card fup-panel" aria-labelledby="fup-heading">
    <div className="fup-heading"><div><h2 id="fup-heading">Fair usage</h2><p>Set data allowances, reduced speeds, and temporary exceptions. Requested and confirmed router states are shown separately.</p></div>
      {canManage && <button disabled={busy} onClick={() => setEditing({ ...initial })}>New policy</button>}</div>
    {error && <p role="alert" className="fup-error">{error}</p>}{message && <p role="status">{message}</p>}
    {loading ? <p role="status">Loading fair usage…</p> : <>
      <div className="fup-policy-grid">{policies.map(p => <article key={p._id} className="fup-policy-card">
        <span className="fup-label">{p.enabled ? 'Enabled' : 'Disabled'}</span><h3>{p.name}</h3>
        <strong>{formatBytes(p.includedBytes)}</strong><p>{p.period === 'monthly' ? 'Calendar month · ' + p.resetTimezone : 'Previous 30 days'} · {p.measurement || 'combined'}</p>
        <p>Warn at {p.warningPercent}% · Reduce at {p.throttlePercent}%{p.hardBlockPercent != null ? ' · Block at ' + p.hardBlockPercent + '%' : ''}</p>
        <p>Reduced speed: {p.throttleDownload} down / {p.throttleUpload} up</p>
        {canManage && <button className="secondary" disabled={busy} onClick={() => setEditing({ ...initial, ...Object.fromEntries(Object.keys(initial).map(k => [k, p[k] ?? initial[k]])), _id: p._id })}>Edit {p.name}</button>}
      </article>)}</div>
      {!policies.length && <p className="empty-state">Create a policy, then assign it to a subscriber below.</p>}
      <h3>Subscriber enforcement</h3><button className="secondary" disabled={busy} onClick={() => act(() => Promise.resolve(), 'Status refreshed.')}>Refresh status</button>
      <div className="table-scroll" role="region" aria-label="Fair usage subscribers" tabIndex={0}><table><thead><tr><th>Subscriber</th><th>Policy</th><th>Usage</th><th>Enforcement</th><th>Actions</th></tr></thead><tbody>{items.map(a => <tr key={a._id}>
        <td>{a.username || a.customerId}<small>{a.accessType}</small></td>
        <td>{canManage ? <select aria-label={'Policy for ' + (a.username || a.customerId)} disabled={busy || a.status === 'released'} value={a.fupPolicyId || ''} onChange={e => act(() => api.put('/network/fup-policies/assignments/' + a._id, { policyId: e.target.value || null }), 'Policy assignment updated.')}><option value="">No policy</option>{policies.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}</select> : policies.find(p => p._id === a.fupPolicyId)?.name || 'No policy'}</td>
        <td>{a.usage ? formatBytes(a.usage.consumedBytes) : 'Awaiting accounting'}{a.usage && <small>{a.usage.state}</small>}</td>
        <td><span>Requested: {a.fup?.desired || 'normal'}</span><small>Confirmed: {a.fup?.applied || 'normal'}</small>{a.fup?.lastError && <small className="fup-error">{a.fup.lastError}</small>}{a.fup?.overrideUntil && new Date(a.fup.overrideUntil) > new Date() && <small>Exception until {new Date(a.fup.overrideUntil).toLocaleString()}</small>}</td>
        <td>{canManage && <div className="fup-actions"><button className="secondary" disabled={busy} onClick={() => act(() => api.post('/network/fup-policies/assignments/' + a._id + '/evaluate'), 'Usage evaluated.')}>Evaluate</button><button className="secondary" disabled={busy} onClick={() => act(() => api.post('/network/fup-policies/assignments/' + a._id + '/retry'), 'Current operation queued for retry.')}>Retry</button><button className="secondary" disabled={busy} onClick={() => setOverride({ id: a._id, reason: '', hours: 24 })}>Exception</button>{a.fup?.overrideUntil && <button className="secondary" disabled={busy} onClick={() => act(() => api.post('/network/fup-policies/assignments/' + a._id + '/override', { until: null }), 'Exception removed.')}>End exception</button>}</div>}</td>
      </tr>)}</tbody></table></div>
      {!items.length && <p>No network assignments yet. Create subscriber assignments before applying fair usage.</p>}
      {next && <button className="secondary" disabled={busy} onClick={() => { setBusy(true); load(next).catch(() => setError('Unable to load more subscribers.')).finally(() => setBusy(false)); }}>Load more subscribers</button>}
      {notices.length > 0 && <><h3>Usage notices</h3><ul className="fup-notices">{notices.map(n => <li key={n._id}><span>{n.message}</span>{canManage && <button className="secondary" disabled={busy} onClick={() => act(() => api.post('/network/fup-policies/notices/' + n._id + '/acknowledge'), 'Notice acknowledged.')}>Acknowledge</button>}</li>)}</ul></>}
    </>}
    <Modal open={!!editing} title={editing?._id ? 'Edit fair usage policy' : 'New fair usage policy'} onClose={() => { if (!busy) setEditing(null); }}>
      {editing && <form onSubmit={save}>{error && <p role="alert" className="fup-error">{error}</p>}<div className="fup-form-grid">
        <Field label="Policy name"><input required maxLength={100} value={editing.name} onChange={e => update('name', e.target.value)} /></Field>
        <Field label="Data allowance (GB)"><input required type="number" min="0.001" max="18446744073" step="0.000000001" value={bytesToGb(editing.includedBytes)} onChange={e => update('includedBytes', gbToBytes(e.target.value))} /></Field>
        <Field label="Usage window"><select value={editing.period} onChange={e => update('period', e.target.value)}><option value="monthly">Calendar month</option><option value="rolling-30d">Previous 30 days</option></select></Field>
        <Field label="Count"><select value={editing.measurement} onChange={e => update('measurement', e.target.value)}><option value="combined">Upload + download</option><option value="download">Download only</option><option value="upload">Upload only</option></select></Field>
        <Field label="Reset time zone"><input required value={editing.resetTimezone} onChange={e => update('resetTimezone', e.target.value)} /></Field>
        <Field label="Warn at (%)"><input type="number" min="1" max="1000" required value={editing.warningPercent} onChange={e => update('warningPercent', Number(e.target.value))} /></Field>
        <Field label="Reduce speed at (%)"><input type="number" min="1" max="1000" required value={editing.throttlePercent} onChange={e => update('throttlePercent', Number(e.target.value))} /></Field>
        <Field label="Block at (%) · optional"><input type="number" min="1" max="10000" value={editing.hardBlockPercent ?? ''} onChange={e => update('hardBlockPercent', e.target.value ? Number(e.target.value) : null)} /></Field>
        <Field label="Reduced download · e.g. 2M"><input required value={editing.throttleDownload} onChange={e => update('throttleDownload', e.target.value)} /></Field>
        <Field label="Reduced upload · e.g. 512K"><input required value={editing.throttleUpload} onChange={e => update('throttleUpload', e.target.value)} /></Field>
        <label><input type="checkbox" checked={editing.enabled} onChange={e => update('enabled', e.target.checked)} /> Policy enabled</label>
      </div><p>Disabling a policy queues restoration. Billing suspensions remain in effect.</p><div className="form-actions"><button disabled={busy} type="submit">Save policy</button><button className="secondary" disabled={busy} type="button" onClick={() => setEditing(null)}>Cancel</button></div></form>}
    </Modal>
    <Modal open={!!override} title="Temporary fair usage exception" onClose={() => { if (!busy) setOverride(null); }}>{override && <form onSubmit={e => { e.preventDefault(); act(async () => { await api.post('/network/fup-policies/assignments/' + override.id + '/override', { until: new Date(Date.now() + override.hours * 3600000).toISOString(), reason: override.reason }); setOverride(null); }, 'Temporary exception saved.'); }}>
      <Field label="Duration (hours)"><input type="number" min="1" max="720" required value={override.hours} onChange={e => setOverride({ ...override, hours: Number(e.target.value) })} /></Field>
      <Field label="Reason"><input required maxLength={300} value={override.reason} onChange={e => setOverride({ ...override, reason: e.target.value })} /></Field><div className="form-actions"><button disabled={busy}>Apply exception</button></div></form>}</Modal>
  </section>;
}
