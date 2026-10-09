import React, { useEffect, useState } from 'react';
import { api } from '../lib/apiClient';
import { Field } from './ui/Field';
import { Modal } from './ui/Modal';
import { Link } from 'react-router-dom';
const id = row => String(row._id || row.id);
const serviceName = type => ({ pppoe: 'PPPoE', static: 'Static IP', hotspot: 'Hotspot' })[type] || type;
export default function NetworkSubscribers({ routers, selected, canManage, customerId, serviceType }) {
  const [items, setItems] = useState([]), [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [draft, setDraft] = useState(null), [confirmation, setConfirmation] = useState(null);
  const [cursor, setCursor] = useState(null), [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState(''), [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState([]), [discovering, setDiscovering] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState(null), [newPassword, setNewPassword] = useState('');
  useEffect(() => {
    let disposed = false; setLoading(true); setError('');
    Promise.all([api.get('/network/assignments', { params: { limit: 100, customerId, accessType: serviceType } }), api.get('/customers')])
      .then(([a, c]) => { if (!disposed) { setItems(a.data.items); setCursor(a.data.nextCursor); setCustomers(Array.isArray(c.data) ? c.data : c.data.items || []); } })
      .catch(e => { if (!disposed) setError(e.message || 'Unable to load subscribers'); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [refresh, customerId, serviceType]);
  useEffect(() => {
    setCandidates([]);
    if (draft?.mode !== 'link' || !draft.routerId) return;
    let disposed = false; setDiscovering(true);
    api.get('/network/assignments/discover/pppoe', { params: { routerId: draft.routerId } })
      .then(({ data }) => { if (!disposed) setCandidates(data.items || []); })
      .catch(e => { if (!disposed) setError(e.message); })
      .finally(() => { if (!disposed) setDiscovering(false); });
    return () => { disposed = true; };
  }, [draft?.mode, draft?.routerId]);
  const customerLabel = key => { const c = customers.find(c => id(c) === String(key)); return c ? [c.name, c.accountNumber].filter(Boolean).join(' · ') : 'Customer ' + String(key).slice(-6); };
  const routerLabel = key => routers.find(r => id(r) === String(key))?.name || 'Unavailable router';
  const linkCustomer = customers.find(c => id(c) === draft?.customerId);
  const matchingAccounts = candidates.filter(c => [linkCustomer?.accountNumber, ...(linkCustomer?.accountAliases || [])].includes(c.username));
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
    if (draft.mode === 'link') {
      await perform(async () => { await api.post('/network/assignments/link', { customerId: draft.customerId, routerId: draft.routerId, username: draft.username }); setDraft(null); }, 'Existing account link queued. Billing and manual access rules apply after confirmation.');
      return;
    }
    if (draft.accessType === 'static') payload.ipAddress = draft.ipAddress.trim();
    else {
      Object.assign(payload, { username: draft.username.trim(), password: draft.password, [draft.accessType === 'pppoe' ? 'pppProfile' : 'hotspotProfile']: draft.profile.trim() });
      if (draft.accessType === 'hotspot' && draft.macAddress?.trim()) payload.macAddress = draft.macAddress.trim();
    }
    await perform(async () => { await api.post('/network/assignments', payload); setDraft(null); }, 'Provisioning queued. Confirmed state changes after the router responds.');
  }
  async function loadMore() {
    setLoading(true); setError('');
    try { const { data } = await api.get('/network/assignments', { params: { limit: 100, after: cursor, customerId, accessType: serviceType } }); setItems(current => [...current, ...data.items]); setCursor(data.nextCursor); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }
  const visible = items.filter(a => (!filter || a.accessType === filter) && [customerLabel(a.customerId), routerLabel(a.routerId), a.username, a.ipAddress].some(v => String(v || '').toLowerCase().includes(query.toLowerCase())));
  return <section className="workspace-card">
    <h2>{serviceType === 'pppoe' ? 'Linked PPPoE services' : 'Subscriber connectivity'}</h2>
    <p>{serviceType === 'pppoe' ? 'Add or link a customer’s local PPPoE account and manage its access and credentials.' : 'Create and manage local PPPoE, static IP and hotspot services.'} Requested changes remain pending until the router confirms them.</p>
    {error && !draft && !confirmation && !passwordTarget && <p role="alert" className="notice error">{error}</p>}
    {notice && <p role="status" className="notice">{notice}</p>}
    <div className="network-toolbar">
      <Field label="Search loaded subscribers"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Customer, username, IP or router" /></Field>
      {!serviceType && <Field label="Service filter"><select value={filter} onChange={e => setFilter(e.target.value)}><option value="">All services</option>{['pppoe', 'static', 'hotspot'].map(t => <option key={t} value={t}>{serviceName(t)}</option>)}</select></Field>}
      <div className="network-actions">
        {canManage && <button className="primary" disabled={!routers.length || loading || busy} onClick={() => { setError(''); setDraft({ mode: 'create', routerId: selected || id(routers[0]), customerId: customerId || '', accessType: serviceType || customers.find(c => id(c) === customerId)?.connectionType || 'pppoe', username: '', password: '', profile: '', ipAddress: '', macAddress: '' }); }}>Add subscriber</button>}
        <button className="secondary" disabled={loading || busy} onClick={() => setRefresh(n => n + 1)}>Refresh subscribers</button>
      </div>
    </div>
    <p className="network-note">Showing {visible.length} of {items.length} loaded assignments. {cursor ? 'Load more to search older assignments.' : ''}</p>
    {loading && <p role="status">Loading subscribers…</p>}
    {visible.length > 0 ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Subscriber assignments"><table>
      <thead><tr><th>Subscriber</th><th>Service / router</th><th>Requested</th><th>Confirmed</th><th>Fair usage</th><th>Actions</th></tr></thead>
      <tbody>{visible.map(a => <tr key={a._id}>
        <td><strong><Link to={'/customers?customerId=' + a.customerId}>{customerLabel(a.customerId)}</Link></strong><small>{a.username || a.ipAddress}</small>{a.provisioningMode === 'link' && <small>Linked existing account</small>}</td>
        <td>{serviceName(a.accessType)}<small>{routerLabel(a.routerId)}</small></td>
        <td>{a.desiredState === 'absent' ? 'Release' : a.desiredState === 'suspended' ? 'Suspended' : 'Active'}<small>Manual: {a.manualState || a.desiredState}</small><small>Billing: {a.billingState === 'blocked' ? 'Restricted' : 'Allowed'}</small></td>
        <td>{a.observedState || 'unknown'}<small>{a.status === 'provisioning' ? 'Awaiting router confirmation' : a.lastSynchronizedAt ? new Date(a.lastSynchronizedAt).toLocaleString() : 'Not yet verified'}</small>{a.lastError && <small className="network-error-detail">{a.lastError}</small>}</td>
        <td>{a.fupPolicyId ? <>Requested: {a.fup?.desired || 'normal'}<small>Confirmed: {a.fup?.applied || 'normal'}</small></> : 'No policy'}</td>
        <td>{canManage && a.status !== 'released' && a.desiredState !== 'absent' && a.authenticationMode !== 'radius' && <div className="network-actions">
          <button className="secondary" disabled={busy} onClick={() => { setError(''); setConfirmation({ a, action: (a.manualState || a.desiredState) === 'suspended' ? 'resume' : 'suspend' }); }}>{(a.manualState || a.desiredState) === 'suspended' ? 'Resume' : 'Suspend'}</button>
          {a.accessType === 'pppoe' && <button className="secondary" disabled={busy} onClick={() => { setError(''); setNewPassword(''); setPasswordTarget(a); }}>Change password</button>}
          <button className="secondary" disabled={busy} onClick={() => { setError(''); setConfirmation({ a, action: 'release' }); }}>Release</button>
        </div>}</td>
      </tr>)}</tbody></table></div> : !loading && <p className="empty-state">No matching assignments. Add a subscriber or adjust your filters.</p>}
    {cursor && <button className="secondary" disabled={loading} onClick={loadMore}>Load more subscribers</button>}
    <Modal open={!!draft} onClose={() => { if (!busy) setDraft(null); }} title="Add network subscriber">{draft && <form className="network-form" onSubmit={submit}>
      {error && <p role="alert" className="notice error">{error}</p>}
      {draft.accessType === 'pppoe' && <Field label="Account setup"><select value={draft.mode} onChange={e => setDraft(d => ({ ...d, mode: e.target.value, username: '', password: '', profile: '' }))}><option value="create">Create new router account</option><option value="link">Link existing router account</option></select></Field>}
      <div className="network-form-grid">
        <Field label="Service type"><select disabled={!!serviceType} value={draft.accessType} onChange={e => setDraft(d => ({ ...d, mode: 'create', accessType: e.target.value, customerId: customerId || '', password: '', profile: '', username: '', macAddress: '', ipAddress: '' }))}>{['pppoe', 'static', 'hotspot'].map(t => <option key={t} value={t}>{serviceName(t)}</option>)}</select></Field>
        <Field label="Router"><select required value={draft.routerId} onChange={e => setDraft(d => ({ ...d, routerId: e.target.value, username: '', profile: '' }))}>{routers.map(r => <option key={id(r)} value={id(r)}>{r.name}</option>)}</select></Field>
        <Field label="Customer"><select required disabled={!!customerId} value={draft.customerId} onChange={e => update('customerId', e.target.value)}><option value="">Select customer</option>{customers.filter(c => c.status !== 'archived' && (draft.accessType === 'hotspot' || c.connectionType === draft.accessType)).map(c => <option key={id(c)} value={id(c)}>{customerLabel(id(c))}</option>)}</select></Field>
        {draft.mode === 'link' ? <Field label="Existing PPPoE account"><select required disabled={discovering} value={draft.username} onChange={e => update('username', e.target.value)}><option value="">{discovering ? 'Checking selected router…' : 'Select an unlinked account'}</option>{candidates.map(c => <option key={c.username} value={c.username}>{c.username} · {c.profile}{c.disabled ? ' · disabled' : ''}</option>)}</select></Field> : draft.accessType === 'static' ? <Field label="Subscriber IPv4 address" hint="Use one address assigned to this subscriber; not a subnet."><input required value={draft.ipAddress} onChange={e => update('ipAddress', e.target.value)} placeholder="192.168.10.20" /></Field> : <>
          <Field label="Subscriber username"><input required maxLength={128} value={draft.username} onChange={e => update('username', e.target.value)} autoComplete="off" /></Field>
          <Field label="Subscriber password" hint="8–128 characters; stored encrypted."><input type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={draft.password} onChange={e => update('password', e.target.value)} /></Field>
          <Field label={draft.accessType === 'pppoe' ? 'PPP profile name' : 'Hotspot profile name'} hint="Exact name of an existing profile on this router."><input required maxLength={128} value={draft.profile} onChange={e => update('profile', e.target.value)} /></Field>
          {draft.accessType === 'hotspot' && <Field label="Device MAC address (optional)"><input value={draft.macAddress} onChange={e => update('macAddress', e.target.value)} placeholder="AA:BB:CC:DD:EE:FF" /></Field>}
        </>}
      </div>
      <p className="network-note">{draft.mode === 'link' ? 'Confirm this account belongs to the selected customer. Linking preserves its password and profile and adopts it for billing, suspension and release. A billing restriction can disconnect it.' : draft.accessType === 'static' ? 'Creates a managed queue for the assigned IP. Address delivery and subscriber routing must already be configured.' : 'Creates a local router account. RADIUS subscriber authorization is managed by your external RADIUS integration.'} Access remains restricted until billing entitlement is active. The billing plan does not automatically change the router profile.</p>
      {draft.mode === 'link' && !discovering && <p className="network-note">{matchingAccounts.length > 1 ? 'Multiple router accounts match this customer’s billing references. Review them before choosing one.' : matchingAccounts.length === 1 ? 'Billing reference match: ' + matchingAccounts[0].username + '. Verify the subscriber before linking.' : 'No exact billing-reference match found. Verify account ownership before linking.'}</p>}
      {draft.mode === 'link' && <label className="network-options"><input type="checkbox" required />I confirm this router account belongs to the selected customer.</label>}
      <div className="form-actions"><button disabled={busy} type="submit">{busy ? 'Queueing…' : 'Queue provisioning'}</button><button className="secondary" type="button" disabled={busy} onClick={() => setDraft(null)}>Cancel</button></div>
    </form>}</Modal>
    <Modal open={!!confirmation} onClose={() => { if (!busy) setConfirmation(null); }} title="Confirm subscriber change">{confirmation && <>
      <p>{confirmation.action === 'release' ? 'Remove the managed router account or queue for' : confirmation.action === 'suspend' ? 'Suspend network access for' : 'Resume network access for'} <strong>{customerLabel(confirmation.a.customerId)}</strong> ({confirmation.a.username || confirmation.a.ipAddress})?</p>
      <p className="network-note">{confirmation.action === 'resume' ? 'Billing and fair usage restrictions remain in effect.' : 'This action can interrupt this subscriber’s connection.'}</p>
      {error && <p role="alert" className="notice error">{error}</p>}
      <div className="form-actions"><button disabled={busy} onClick={() => perform(async () => { const { a, action } = confirmation; if (action === 'release') await api.delete('/network/assignments/' + a._id); else await api.patch('/network/assignments/' + a._id, { desiredState: action === 'resume' ? 'present' : 'suspended' }); setConfirmation(null); }, 'Change queued; refresh to check router confirmation.')}>Confirm change</button><button className="secondary" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button></div>
    </>}</Modal>
    <Modal open={!!passwordTarget} onClose={() => { if (!busy) setPasswordTarget(null); }} title="Change subscriber password">{passwordTarget && <form className="network-form" onSubmit={e => { e.preventDefault(); perform(async () => { await api.post('/network/assignments/' + passwordTarget._id + '/password', { password: newPassword }); setPasswordTarget(null); setNewPassword(''); }, 'Password update queued. Existing sessions keep their connection until reconnect.'); }}>
      <p>Update credentials for {passwordTarget.username} on {routerLabel(passwordTarget.routerId)}.</p>
      {error && <p role="alert">{error}</p>}
      <Field label="New subscriber password"><input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={newPassword} onChange={e => setNewPassword(e.target.value)} /></Field>
      <div className="form-actions"><button disabled={busy} type="submit">Queue password update</button><button className="secondary" type="button" disabled={busy} onClick={() => setPasswordTarget(null)}>Cancel</button></div>
    </form>}</Modal>
  </section>;
}
