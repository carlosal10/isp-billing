import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/apiClient';
import { useAuth } from '../context/AuthContext';
import { useServer } from '../context/ServerContext';
import { Field } from './ui/Field';
import { Modal } from './ui/Modal';
import CustomerBillingForm from './CustomerBillingForm';
import CustomerDetailsPanel from './CustomerDetailsPanel';
import NetworkSubscribers from './NetworkSubscribers';
import '../network.css';
export default function CustomersModal({ isOpen = false, onClose, standalone = false }) {
  const [customers, setCustomers] = useState([]), [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null), [archiving, setArchiving] = useState(null), [refresh, setRefresh] = useState(0);
  const [params, setParams] = useSearchParams();
  const { role } = useAuth(), { servers, selected } = useServer();
  const visible = standalone || isOpen, canManage = ['owner', 'admin'].includes(role);
  const current = customers.find(c => c._id === params.get('customerId'));
  useEffect(() => {
    if (!visible) return;
    let disposed = false; setLoading(true); setError('');
    Promise.all([api.get('/customers'), api.get('/plans')])
      .then(([c, p]) => { if (!disposed) { setCustomers(Array.isArray(c.data) ? c.data : c.data.items || []); setPlans(Array.isArray(p.data) ? p.data : p.data.plans || []); } })
      .catch(e => { if (!disposed) setError(e.message); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [visible, refresh]);
  async function action(work, message) {
    setBusy(true); setError(''); setNotice('');
    try { await work(); setNotice(message); setRefresh(n => n + 1); } catch (e) { setError(e.response?.data?.message || e.message); } finally { setBusy(false); }
  }
  async function save(body) {
    const payload = { ...body }; if (!payload.accountNumber.trim()) delete payload.accountNumber;
    await action(async () => {
      const { data } = editing?._id ? await api.put('/customers/' + editing._id, payload) : await api.post('/customers', payload);
      setParams({ customerId: data.customer._id }); setEditing(null);
    }, 'Customer saved. Add or link a service below when ready.');
  }
  if (!visible) return null;
  const content = <>
    <header className="workspace-header"><div><span className="eyebrow">WORKSPACE</span><h1>Customers</h1><p>Customer identity and billing, with one shared workflow for linked network services.</p></div>{canManage && <button className="primary" onClick={() => { setError(''); setEditing({}); }}>Add customer</button>}</header>
    {error && !editing && !archiving && <p role="alert" className="notice error">{error}</p>}
    {notice && <p role="status" className="notice">{notice}</p>}
    <section className="workspace-card"><h2>Customer directory</h2><Field label="Search customers"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, account number, email or phone" /></Field>
      {loading ? <p role="status">Loading customers…</p> : <div className="table-scroll" role="region" aria-label="Customers" tabIndex={0}><table><thead><tr><th>Customer</th><th>Billing plan</th><th>Billing status</th><th>Actions</th></tr></thead><tbody>
        {customers.filter(c => [c.name, c.accountNumber, c.email, c.phone].some(v => String(v || '').toLowerCase().includes(query.toLowerCase()))).map(c => <tr key={c._id}><td><strong>{c.name}</strong><small>{c.accountNumber}</small></td><td>{c.plan?.name || 'No plan'}<small>{c.connectionType}</small></td><td>{c.status}<small>{c.expiryDate ? 'Expires ' + new Date(c.expiryDate).toLocaleDateString() : 'No active entitlement recorded'}</small></td><td><div className="network-actions">
          <button className="secondary" onClick={() => setParams({ customerId: c._id })}>View customer</button>
          {canManage && c.status !== 'archived' && <><button className="secondary" onClick={() => { setError(''); setEditing(c); }}>Edit billing details</button><button className="secondary" onClick={() => { setError(''); setArchiving(c); }}>Archive</button></>}
        </div></td></tr>)}
      </tbody></table></div>}
      {!loading && !customers.length && <p className="empty-state">Create a customer, then add or link their service.</p>}
    </section>
    {current && <><CustomerDetailsPanel customer={current} onClose={() => setParams({})} onUpdated={() => setRefresh(n => n + 1)} />
      {current.status !== 'archived' && <NetworkSubscribers key={current._id + ':' + refresh} customerId={current._id} routers={servers || []} selected={selected} canManage={canManage} />}
    </>}
    <Modal open={!!editing} onClose={() => { if (!busy) setEditing(null); }} title={editing?._id ? 'Edit customer billing details' : 'Add customer'}>
      {editing && <>{error && <p role="alert" className="notice error">{error}</p>}<CustomerBillingForm key={editing._id || 'new'} customer={editing._id ? editing : undefined} plans={plans} busy={busy} onSave={save} onCancel={() => setEditing(null)} /></>}
    </Modal>
    <Modal open={!!archiving} onClose={() => { if (!busy) setArchiving(null); }} title="Archive customer">
      <p>Archive {archiving?.name}? Release all linked services and confirm removal first. Billing history is retained. Existing unlinked legacy services must be linked and released before archival.</p>
      {error && <p role="alert" className="notice error">{error}</p>}
      <div className="form-actions"><button disabled={busy} onClick={() => action(async () => { await api.delete('/customers/' + archiving._id); setArchiving(null); }, 'Customer archived; billing history retained.')}>Confirm archival</button><button className="secondary" disabled={busy} onClick={() => setArchiving(null)}>Cancel</button></div>
    </Modal>
  </>;
  return standalone ? <main className="workspace-page network-workspace">{content}</main> : <Modal open={isOpen} onClose={onClose} title="Customers">{content}</Modal>;
}
