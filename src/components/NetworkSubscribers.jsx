import React, { useEffect, useState } from 'react';
import { api } from '../lib/apiClient';
import { Field } from './ui/Field';
import { Modal } from './ui/Modal';
const id = row => String(row._id || row.id);
const serviceName = type => ({ pppoe: 'PPPoE', static: 'Static IP', hotspot: 'Hotspot' })[type] || type;
export default function NetworkSubscribers({ routers, selected, canManage }) {
  const [items, setItems] = useState([]), [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [draft, setDraft] = useState(null), [confirmation, setConfirmation] = useState(null);
  const [cursor, setCursor] = useState(null), [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState(''), [query, setQuery] = useState('');
  useEffect(() => {
    let disposed = false; setLoading(true); setError('');
    Promise.all([api.get('/network/assignments', { params: { limit: 100 } }), api.get('/customers')])
      .then(([a, c]) => { if (!disposed) { setItems(a.data.items); setCursor(a.data.nextCursor); setCustomers(Array.isArray(c.data) ? c.data : c.data.items || []); } })
      .catch(e => { if (!disposed) setError(e.message || 'Unable to load subscribers'); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [refresh]);
  const customerLabel = key => { const c = customers.find(c => id(c) === String(key)); return c ? [c.name, c.accountNumber].filter(Boolean).join(' · ') : 'Customer ' + String(key).slice(-6); };
  const routerLabel = key => routers.find(r => id(r) === String(key))?.name || 'Unavailable router';
  async function perform(work, message) {
    setBusy(true); setError(''); setNotice('');
    try { await work(); setNotice(message); setRefresh(n => n + 1); }
    catch (e) { setError(e.message || 'Request failed'); }
    finally { setBusy(false); }
  }
  function update(key, value) { setDraft(d => ({ ...d, [key]: value })); }
  async function submit(event) {
    event.preventDefault();
    const payload = { customerId: draft.customerId, routerId: draft.routerId, accessType: draft.accessType };
    if (draft.accessType === 'static') payload.ipAddress = draft.ipAddress.trim();
    else {
      Object.assign(payload, { username: draft.username.trim(), password: draft.password, [draft.accessType === 'pppoe' ? 'pppProfile' : 'hotspotProfile']: draft.profile.trim() });
      if (draft.accessType === 'hotspot' && draft.macAddress?.trim()) payload.macAddress = draft.macAddress.trim();
    }
    await perform(async () => { await api.post('/network/assignments', payload); setDraft(null); }, 'Provisioning queued. Confirmed state changes after the router responds.');
  }
  async function loadMore() {
    setLoading(true); setError('');
    try { const { data } = await api.get('/network/assignments', { params: { limit: 100, after: cursor } }); setItems(current => [...current, ...data.items]); setCursor(data.nextCursor); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }
  const visible = items.filter(a => (!filter || a.accessType === filter) && [customerLabel(a.customerId), routerLabel(a.routerId), a.username, a.ipAddress].some(v => String(v || '').toLowerCase().includes(query.toLowerCase())));
  return <section className="workspace-card">
    <h2>Subscriber connectivity</h2>
    <p>Create and manage local PPPoE, static IP and hotspot services. Requested changes remain pending until the router confirms them.</p>
    {error && !draft && !confirmation && <p role="alert" className="notice error">{error}</p>}
    {notice && <p role="status" className="notice">{notice}</p>}
    <div className="network-toolbar">
      <Field label="Search loaded subscribers"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Customer, username, IP or router" /></Field>
      <Field label="Service filter"><select value={filter} onChange={e => setFilter(e.target.value)}><option value="">All services</option>{['pppoe', 'static', 'hotspot'].map(t => <option key={t} value={t}>{serviceName(t)}</option>)}</select></Field>
      <div className="network-actions">
        {canManage && <button disabled={!routers.length || loading || busy} onClick={() => { setError(''); setDraft({ routerId: selected || id(routers[0]), customerId: '', accessType: 'pppoe', username: '', password: '', profile: '', ipAddress: '', macAddress: '' }); }}>Add subscriber</button>}
        <button className="secondary" disabled={loading || busy} onClick={() => setRefresh(n => n + 1)}>Refresh subscribers</button>
      </div>
    </div>
    <p className="network-note">Showing {visible.length} of {items.length} loaded assignments. {cursor ? 'Load more to search older assignments.' : ''}</p>
    {loading && <p role="status">Loading subscribers…</p>}
    {visible.length > 0 ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Subscriber assignments"><table>
      <thead><tr><th>Subscriber</th><th>Service / router</th><th>Requested</th><th>Confirmed</th><th>Fair usage</th><th>Actions</th></tr></thead>
      <tbody>{visible.map(a => <tr key={a._id}>
        <td><strong>{customerLabel(a.customerId)}</strong><small>{a.username || a.ipAddress}</small></td>
        <td>{serviceName(a.accessType)}<small>{routerLabel(a.routerId)}</small></td>
        <td>{a.desiredState === 'absent' ? 'Release' : a.desiredState === 'suspended' ? 'Suspended' : 'Active'}</td>
        <td>{a.observedState || 'unknown'}<small>{a.status === 'provisioning' ? 'Awaiting router confirmation' : a.lastSynchronizedAt ? new Date(a.lastSynchronizedAt).toLocaleString() : 'Not yet verified'}</small>{a.lastError && <small className="network-error-detail">{a.lastError}</small>}</td>
        <td>{a.fupPolicyId ? <>Requested: {a.fup?.desired || 'normal'}<small>Confirmed: {a.fup?.applied || 'normal'}</small></> : 'No policy'}</td>
        <td>{canManage && a.status !== 'released' && a.desiredState !== 'absent' && a.authenticationMode !== 'radius' && <div className="network-actions">
          <button className="secondary" disabled={busy} onClick={() => { setError(''); setConfirmation({ a, action: a.desiredState === 'suspended' ? 'resume' : 'suspend' }); }}>{a.desiredState === 'suspended' ? 'Resume' : 'Suspend'}</button>
          <button className="secondary" disabled={busy} onClick={() => { setError(''); setConfirmation({ a, action: 'release' }); }}>Release</button>
        </div>}</td>
      </tr>)}</tbody></table></div> : !loading && <p className="empty-state">No matching assignments. Add a subscriber or adjust your filters.</p>}
    {cursor && <button className="secondary" disabled={loading} onClick={loadMore}>Load more subscribers</button>}
    <Modal open={!!draft} onClose={() => { if (!busy) setDraft(null); }} title="Add network subscriber">{draft && <form className="network-form" onSubmit={submit}>
      {error && <p role="alert" className="notice error">{error}</p>}
      <div className="network-form-grid">
        <Field label="Service type"><select value={draft.accessType} onChange={e => setDraft(d => ({ ...d, accessType: e.target.value, customerId: '', password: '', profile: '', username: '', macAddress: '', ipAddress: '' }))}>{['pppoe', 'static', 'hotspot'].map(t => <option key={t} value={t}>{serviceName(t)}</option>)}</select></Field>
        <Field label="Router"><select required value={draft.routerId} onChange={e => update('routerId', e.target.value)}>{routers.map(r => <option key={id(r)} value={id(r)}>{r.name}</option>)}</select></Field>
        <Field label="Customer"><select required value={draft.customerId} onChange={e => update('customerId', e.target.value)}><option value="">Select customer</option>{customers.filter(c => draft.accessType === 'hotspot' || c.connectionType === draft.accessType).map(c => <option key={id(c)} value={id(c)}>{customerLabel(id(c))}</option>)}</select></Field>
        {draft.accessType === 'static' ? <Field label="Subscriber IPv4 address" hint="Use one address assigned to this subscriber; not a subnet."><input required value={draft.ipAddress} onChange={e => update('ipAddress', e.target.value)} placeholder="192.168.10.20" /></Field> : <>
          <Field label="Subscriber username"><input required maxLength={128} value={draft.username} onChange={e => update('username', e.target.value)} autoComplete="off" /></Field>
          <Field label="Subscriber password" hint="8–128 characters; stored encrypted."><input type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={draft.password} onChange={e => update('password', e.target.value)} /></Field>
          <Field label={draft.accessType === 'pppoe' ? 'PPP profile name' : 'Hotspot profile name'} hint="Exact name of an existing profile on this router."><input required maxLength={128} value={draft.profile} onChange={e => update('profile', e.target.value)} /></Field>
          {draft.accessType === 'hotspot' && <Field label="Device MAC address (optional)"><input value={draft.macAddress} onChange={e => update('macAddress', e.target.value)} placeholder="AA:BB:CC:DD:EE:FF" /></Field>}
        </>}
      </div>
      <p className="network-note">{draft.accessType === 'static' ? 'Creates a managed queue for the assigned IP. Address delivery and subscriber routing must already be configured.' : 'Creates a local router account. RADIUS subscriber authorization is managed by your external RADIUS integration.'}</p>
      <div className="form-actions"><button disabled={busy} type="submit">{busy ? 'Queueing…' : 'Queue provisioning'}</button><button className="secondary" type="button" disabled={busy} onClick={() => setDraft(null)}>Cancel</button></div>
    </form>}</Modal>
    <Modal open={!!confirmation} onClose={() => { if (!busy) setConfirmation(null); }} title="Confirm subscriber change">{confirmation && <>
      <p>{confirmation.action === 'release' ? 'Remove the managed router account or queue for' : confirmation.action === 'suspend' ? 'Suspend network access for' : 'Resume network access for'} <strong>{customerLabel(confirmation.a.customerId)}</strong> ({confirmation.a.username || confirmation.a.ipAddress})?</p>
      <p className="network-note">{confirmation.action === 'resume' ? 'Any fair usage restriction remains in effect.' : 'This action can interrupt this subscriber’s connection.'}</p>
      {error && <p role="alert" className="notice error">{error}</p>}
      <div className="form-actions"><button disabled={busy} onClick={() => perform(async () => { const { a, action } = confirmation; if (action === 'release') await api.delete('/network/assignments/' + a._id); else await api.patch('/network/assignments/' + a._id, { desiredState: action === 'resume' ? 'present' : 'suspended' }); setConfirmation(null); }, 'Change queued; refresh to check router confirmation.')}>Confirm change</button><button className="secondary" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button></div>
    </>}</Modal>
  </section>;
}
