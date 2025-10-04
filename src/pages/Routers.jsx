import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/apiClient';

function Row({ s, onPrimary, onTest, onDelete }) {
  return (
    <tr>
      <td>{s.primary ? '★' : ''} {s.name}</td>
      <td>{s.host}:{s.port}</td>
      <td>{s.tls ? 'yes' : 'no'}</td>
      <td>{s.site || '-'}</td>
      <td>{s.lastVerifiedAt ? new Date(s.lastVerifiedAt).toLocaleString() : '-'}</td>
      <td style={{ textAlign:'right', whiteSpace:'nowrap' }}>
        {!s.primary && (<button onClick={() => onPrimary(s)} title="Make primary">Primary</button>)}
        <button onClick={() => onTest(s)} style={{ marginLeft: 8 }}>Test</button>
        <button onClick={() => onDelete(s)} style={{ marginLeft: 8 }} className="danger">Delete</button>
      </td>
    </tr>
  );
}

export default function Routers() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ name: 'default', host: '', port: 8728, username: '', password: '', tls: false, primary: true, site: '' });

  async function load() {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/mikrotik/servers');
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const onChange = (e) => {
    const { id, type, value, checked } = e.target;
    setForm((f) => ({ ...f, [id]: type === 'checkbox' ? checked : value }));
  };

  const onCreate = async (e) => {
    e.preventDefault();
    setMsg(''); setError('');
    try {
      await api.post('/mikrotik/servers', {
        name: form.name.trim() || 'default',
        host: form.host.trim(),
        port: Number(form.port) || (form.tls ? 8729 : 8728),
        username: form.username.trim(),
        password: form.password,
        tls: !!form.tls,
        primary: !!form.primary,
        site: form.site || undefined,
      });
      setMsg('Created');
      setForm((f) => ({ ...f, password: '' }));
      load();
    } catch (e) {
      setError(e?.message || 'Create failed');
    }
  };

  const onPrimary = async (s) => {
    try {
      await api.put(`/mikrotik/servers/${s.id}`, { primary: true });
      load();
    } catch (e) { alert(e?.message || 'Failed'); }
  };

  const onTest = async (s) => {
    setMsg(''); setError('');
    try {
      const { data } = await api.post(`/mikrotik/servers/${s.id}/test`);
      setMsg(`Server ${s.name}: ${data?.identity || 'ok'}`);
      load();
    } catch (e) {
      setError(e?.message || 'Test failed');
    }
  };

  const onDelete = async (s) => {
    if (!window.confirm(`Delete server ${s.name}?`)) return;
    try {
      await api.delete(`/mikrotik/servers/${s.id}`);
      load();
    } catch (e) { alert(e?.message || 'Delete failed'); }
  };

  return (
    <div style={{ padding: 16 }}>
      <h1>MikroTik Servers</h1>
      {error && <div className="msg-err" role="alert">{error}</div>}
      {msg && <div className="msg-ok" role="status">{msg}</div>}

      <form onSubmit={onCreate} className="stacked-form" style={{ maxWidth: 720, marginBottom: 20 }}>
        <h3>Add Server</h3>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12 }}>
          <label>Name<input id="name" value={form.name} onChange={onChange} required /></label>
          <label>Site<input id="site" value={form.site} onChange={onChange} placeholder="Optional label" /></label>
          <label>Host<input id="host" value={form.host} onChange={onChange} required /></label>
          <label>Port<input id="port" type="number" value={form.port} onChange={onChange} /></label>
          <label>User<input id="username" value={form.username} onChange={onChange} required /></label>
          <label>Password<input id="password" type="password" value={form.password} onChange={onChange} required /></label>
          <label style={{ display:'flex', alignItems:'center', gap:8 }}><input id="tls" type="checkbox" checked={form.tls} onChange={onChange} /> TLS (8729)</label>
          <label style={{ display:'flex', alignItems:'center', gap:8 }}><input id="primary" type="checkbox" checked={form.primary} onChange={onChange} /> Set as primary</label>
        </div>
        <button type="submit" style={{ marginTop: 8 }}>Save</button>
      </form>

      <h3>Servers</h3>
      {loading ? (
        <div>Loading…</div>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Address</th>
                <th>TLS</th>
                <th>Site</th>
                <th>Verified</th>
                <th style={{ textAlign:'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(items||[]).map((s) => (
                <Row key={s.id} s={s} onPrimary={onPrimary} onTest={onTest} onDelete={onDelete} />
              ))}
              {(!items || items.length === 0) && (
                <tr><td colSpan={6} style={{ textAlign:'center' }}>No servers yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

