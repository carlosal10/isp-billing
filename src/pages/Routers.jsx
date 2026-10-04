import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/apiClient';
import { useAuth } from '../context/AuthContext';
import { useServer } from '../context/ServerContext';
import { Modal } from '../components/ui/Modal';
import { Field } from '../components/ui/Field';
import FupPanel from '../components/FupPanel';
import RouterConnectionForm from '../components/RouterConnectionForm';
import '../network.css';
const idOf = row => String(row.id || row._id);
export default function Routers() {
  const { role } = useAuth(), { servers, reload, selected, setSelected } = useServer();
  const [tab, setTab] = useState('routers'), [editing, setEditing] = useState(null), [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [sessions, setSessions] = useState([]), [loadingSessions, setLoadingSessions] = useState(false), [operations, setOperations] = useState([]), [loadingOperations, setLoadingOperations] = useState(false), [health, setHealth] = useState({}), [healthLoading, setHealthLoading] = useState({}), [refresh, setRefresh] = useState(0);
  const canManage = ['owner', 'admin'].includes(role);
  const rows = Array.isArray(servers) ? servers : [];
  useEffect(() => {
    if (tab !== 'accounting') return;
    setSessions([]); setError('');
    if (!selected) return;
    let disposed = false;
    setLoadingSessions(true);
    api.get('/mikrotik/servers/' + selected + '/sessions').then(({ data }) => { if (!disposed) setSessions(data.sessions || []); })
      .catch(err => { if (!disposed) setError(err.response?.data?.error || 'Unable to load accounting.'); })
      .finally(() => { if (!disposed) setLoadingSessions(false); });
    return () => { disposed = true; };
  }, [selected, tab, refresh]);
  useEffect(() => {
    if (tab !== 'operations') return;
    let disposed = false;
    setLoadingOperations(true);
    api.get('/network/assignments/operations?limit=200').then(({ data }) => { if (!disposed) setOperations(data.items || []); })
      .catch(err => { if (!disposed) setError(err.response?.data?.error || 'Unable to load network operations.'); })
      .finally(() => { if (!disposed) setLoadingOperations(false); });
    return () => { disposed = true; };
  }, [tab, refresh]);
  async function action(work, success) {
    setBusy(true); setError(''); setMessage('');
    try { const result = await work(); setMessage(typeof success === 'function' ? success(result) : success); await reload(); }
    catch (err) { setError(err.response?.data?.error || 'The operation could not be completed.'); }
    finally { setBusy(false); }
  }
  async function checkHealth(row) {
    const id = idOf(row);
    setHealthLoading(current => ({ ...current, [id]: true })); setError('');
    try {
      const { data } = await api.get('/mikrotik/status', { params: { serverId: id }, timeout: 20000 });
      setHealth(current => ({ ...current, [id]: data }));
    } catch (err) {
      setHealth(current => ({ ...current, [id]: { connected: false, error: err.response?.data?.error || 'Health check failed' } }));
    } finally { setHealthLoading(current => ({ ...current, [id]: false })); }
  }
  return <main className="workspace-page network-workspace">
    <header className="workspace-header"><div><span className="eyebrow">NETWORK OPERATIONS</span><h1>Network workspace</h1><p>Manage router connections and inspect subscriber accounting.</p></div>
      {canManage && <button onClick={() => setEditing({})}>Add router</button>}</header>
    <nav className="network-tabs" aria-label="Network views">{[['routers', 'Routers'], ['accounting', 'RADIUS accounting'], ['fup', 'Fair usage'], ['operations', 'Operations'], ['guide', 'Connection guide']].map(([key, label]) => <button key={key} className="secondary" aria-pressed={tab === key} onClick={() => { setTab(key); setError(''); setMessage(''); }}>{label}</button>)}</nav>
    {error && <div role="alert" className="notice error">{error}</div>}
    {message && <div role="status" className="notice">{message}</div>}
    {tab === 'fup' && <FupPanel canManage={canManage} />}
    {tab === 'operations' && <section className="workspace-card"><h2>Network operations</h2><p>Router provisioning, FUP enforcement, retries, and failed operations are shown here.</p><button className="secondary" onClick={() => setRefresh(value => value + 1)} disabled={loadingOperations}>Refresh</button>{loadingOperations ? <p role="status">Loading operations…</p> : <div className="table-scroll" role="region" aria-label="Network operations" tabIndex={0}><table><thead><tr><th>Operation</th><th>State</th><th>Attempts</th><th>Error</th><th>Action</th></tr></thead><tbody>{operations.map(item => <tr key={item._id}><td>{item.operationType}<small>{new Date(item.createdAt).toLocaleString()}</small></td><td>{item.status}</td><td>{item.attempts}</td><td>{item.lastError || '—'}</td><td>{canManage && ['failed', 'dead-letter'].includes(item.status) && <button className="secondary" disabled={busy} onClick={() => action(() => api.post('/network/assignments/operations/' + item._id + '/retry'), 'Operation queued for retry.')}>Retry</button>}</td></tr>)}</tbody></table></div>}{!loadingOperations && !operations.length && <p className="empty-state">No network operations have been recorded.</p>}</section>}
    {tab === 'routers' && <section className="workspace-card"><h2>Router inventory</h2><p>A successful test verifies API access from the billing server. A saved address alone does not confirm connectivity.</p>
      {rows.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Router inventory"><table><thead><tr><th>Router</th><th>Management address</th><th>Last verified</th><th>Actions</th></tr></thead><tbody>{rows.map(row => <tr key={idOf(row)}>
        <td><strong>{row.name}</strong><small>{row.site || 'No site assigned'}{row.primary ? ' · Default' : ''}</small></td>
        <td>{row.host}:{row.port}<small>{row.tls ? 'TLS verified on connect' : 'Private network API'}</small></td>
        <td>{(() => { const status = health[idOf(row)]; return status ? <><strong className={status.connected ? 'network-health-ok' : 'network-health-bad'}>{status.connected ? 'Connected' : 'Unavailable'}</strong><small>{status.connected ? [status.identity, status.uptime].filter(Boolean).join(' · ') || 'Router responded' : status.error || 'No response'}</small></> : <small>Not checked in this session</small>; })()}</td>
        <td><div className="network-actions"><button className="secondary" disabled={busy} onClick={() => action(() => api.post('/mikrotik/servers/' + idOf(row) + '/test', {}, { timeout: 20000 }), response => 'Connection verified: ' + response.data.identity)}>Test {row.name}</button>
          <button className="secondary" disabled={healthLoading[idOf(row)]} onClick={() => checkHealth(row)}>{healthLoading[idOf(row)] ? 'Checking…' : 'Health'}</button>
          {canManage && <><button className="secondary" onClick={() => setEditing(row)}>Edit {row.name}</button><button className="secondary" onClick={() => setRemoving(row)}>Remove {row.name}</button></>}</div></td>
      </tr>)}</tbody></table></div> : <div className="empty-state"><h3>Connect your first router</h3><p>Use its LAN or tunnel address if the billing server has a private route to it.</p><button className="secondary" onClick={() => setTab('guide')}>View connection guide</button></div>}
      <div className="form-actions"><Link to="/pppoe">Manage local PPPoE users →</Link></div>
    </section>}
    {tab === 'accounting' && <section className="workspace-card"><h2>RADIUS session accounting</h2><p>Latest 100 session snapshots received from your trusted RADIUS integration. Accounting records report usage; they do not authenticate or disconnect subscribers.</p>
      <div className="network-select"><Field label="Accounting router"><select value={selected || ''} onChange={event => setSelected(event.target.value)}><option value="">Select a router</option>{rows.map(row => <option key={idOf(row)} value={idOf(row)}>{row.name}</option>)}</select></Field></div>
      <button className="secondary" onClick={() => setRefresh(value => value + 1)} disabled={!selected || loadingSessions}>Refresh accounting</button>
      {loadingSessions ? <p role="status">Loading accounting…</p> : sessions.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="RADIUS sessions"><table><thead><tr><th>Subscriber</th><th>State</th><th>Upload bytes</th><th>Download bytes</th><th>Last event</th></tr></thead><tbody>{sessions.map(row => <tr key={row._id}><td>{row.username}<small>{row.framedIp || 'No address reported'}</small></td><td>{row.status}</td><td>{BigInt(row.uploadBytes).toLocaleString()}</td><td>{BigInt(row.downloadBytes).toLocaleString()}</td><td>{new Date(row.lastEventAt).toLocaleString()}</td></tr>)}</tbody></table></div>
        : <p className="empty-state">No accounting snapshots received for this router. Connect your RADIUS exporter using an API key with the accounting scope.</p>}
      <p className="network-note">An active session becomes stale after 15 minutes without a newer event. Stale is not proof of disconnection. Records are retained for 90 days.</p>
    </section>}
    {tab === 'guide' && <section className="workspace-card"><h2>Choose the connection path</h2><div className="network-guide">
      <article><h3>Private tunnel · recommended</h3><p>The router initiates a VPN connection to your network gateway. Route the billing server to the router tunnel address. This works behind NAT without exposing the router API publicly.</p></article>
      <article><h3>Local deployment</h3><p>A billing backend on the router network can use its LAN address. Opening the website from your laptop does not put a cloud backend on that LAN.</p></article>
      <article><h3>Direct management</h3><p>A public address or DDNS name can work with a reachable API port and suitable firewall rules. DDNS names the router; it does not bypass NAT or CGNAT.</p></article>
    </div><h3>Where RADIUS fits</h3><p>Use FreeRADIUS for subscriber authentication, authorization and accounting. RouterOS sends requests to it. Keep API management over a private route for provisioning and operational checks. Local PPP secrets can take precedence over RADIUS accounts, so migration needs a staged pilot.</p>
    <p className="network-note">This release accepts accounting snapshots from a trusted exporter. It does not install a VPN or RADIUS server, enable RADIUS authentication, or send disconnect requests.</p></section>}
    <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit router' : 'Add router'}>{editing && <RouterConnectionForm key={editing.id || 'new'} initial={editing.id ? editing : undefined} onSaved={text => { setEditing(null); setMessage(text); reload(); }} />}</Modal>
    <Modal open={!!removing} onClose={() => { if (!busy) setRemoving(null); }} title="Remove router"><p>Remove {removing?.name} from this workspace? This removes its saved management connection. It does not reconfigure the router.</p><div className="form-actions"><button disabled={busy} onClick={() => action(async () => { await api.delete('/mikrotik/servers/' + idOf(removing)); setRemoving(null); }, 'Router removed.')}>Confirm removal</button><button className="secondary" onClick={() => setRemoving(null)} disabled={busy}>Cancel</button></div></Modal>
  </main>;
}
