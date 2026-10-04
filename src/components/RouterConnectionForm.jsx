import React, { useState } from 'react';
import { api } from '../lib/apiClient';
import { Field } from './ui/Field';
import '../network.css';

export default function RouterConnectionForm({ initial, onSaved }) {
  const [form, setForm] = useState({ name: '', site: '', host: '', port: 8729, username: '', password: '', tls: true, primary: false, ...initial });
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const change = event => {
    const { name, value, checked, type } = event.target;
    setForm(previous => ({ ...previous, [name]: type === 'checkbox' ? checked : value,
      ...(name === 'tls' && [8728, 8729].includes(Number(previous.port)) ? { port: checked ? 8729 : 8728 } : {}) }));
  };
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    const payload = { name: form.name.trim(), host: form.host.trim(), port: Number(form.port), tls: form.tls, primary: form.primary, site: form.site.trim() };
    if (form.username.trim()) payload.username = form.username.trim();
    if (form.password) payload.password = form.password;
    try {
      const { data } = initial?.id
        ? await api.put(`/mikrotik/servers/${initial.id}`, payload)
        : await api.post('/mikrotik/servers', payload, { timeout: 20000 });
      setForm(previous => ({ ...previous, password: '' }));
      const result = initial?.id ? 'Router settings saved. Test the connection to verify them.'
        : data.verified ? `Connection verified: ${data.identity}` : `Saved, awaiting verification. ${data.diagnostic?.message || 'Test the connection when the router is reachable.'}`;
      setMessage(result); onSaved?.(result);
    } catch (err) { setError(err.response?.data?.error || 'The request could not be completed. Refresh the router list before retrying.'); }
    finally { setBusy(false); }
  }
  return <form className="network-form" onSubmit={submit}>
    <div className="network-form-grid">
      <Field label="Router name"><input name="name" value={form.name} onChange={change} required maxLength={60} placeholder="Nairobi edge" /></Field>
      <Field label="Site"><input name="site" value={form.site || ''} onChange={change} maxLength={120} placeholder="Optional location" /></Field>
      <Field label="Management address" hint="Use an IP or hostname reachable from the billing server, including a VPN address."><input name="host" value={form.host} onChange={change} required placeholder="10.77.0.2 or router.example.com" /></Field>
      <Field label="API port"><input name="port" type="number" min={1} max={65535} value={form.port} onChange={change} required /></Field>
      <Field label="API username" hint={initial ? 'Leave blank to retain the saved username.' : undefined}><input name="username" value={form.username} onChange={change} required={!initial} autoComplete="off" /></Field>
      <Field label="API password" hint={initial ? 'Leave blank to retain the saved password.' : undefined}><input name="password" type="password" value={form.password} onChange={change} required={!initial} autoComplete="new-password" /></Field>
    </div>
    <div className="network-options">
      <label><input name="tls" type="checkbox" checked={form.tls} onChange={change} /> Verify TLS certificate (API-SSL)</label>
      <label><input name="primary" type="checkbox" checked={form.primary} onChange={change} /> Default router for this workspace</label>
    </div>
    <p className="network-note">{form.tls ? 'The certificate must be trusted by the billing server and match the management address.' : 'Plain API sends credentials without TLS. Use it only across a trusted private network or an encrypted VPN.'}</p>
    {error && <div className="notice error" role="alert">{error}</div>}
    {message && <div className="notice" role="status">{message}</div>}
    <div className="form-actions"><button type="submit" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save router settings' : 'Save and test router'}</button></div>
  </form>;
}
