import React, { useEffect, useState } from 'react';
import { api } from '../lib/apiClient';
import { useServer } from '../context/ServerContext';
import { useAuth } from '../context/AuthContext';
import { Field } from './ui/Field';
import { Modal } from './ui/Modal';
import '../network.css';
export default function PppoeModal({ isOpen = false, onClose, standalone = false }) {
  const visible = standalone || isOpen, { selected, servers, setSelected } = useServer(), { role } = useAuth();
  const [profiles, setProfiles] = useState([]), [loadingProfiles, setLoadingProfiles] = useState(false), [refresh, setRefresh] = useState(0);
  const [operation, setOperation] = useState('add'), [username, setUsername] = useState(''), [password, setPassword] = useState(''), [profile, setProfile] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [confirm, setConfirm] = useState(false);
  useEffect(() => {
    setProfiles([]); setProfile(''); setError(''); setMessage('');
    if (!visible || !selected) return;
    let disposed = false; setLoadingProfiles(true);
    api.get('/pppoe/profiles', { headers: { 'x-isp-server': selected } }).then(({ data }) => {
      if (!disposed) { setProfiles(data.profiles || []); setProfile(data.profiles?.[0]?.name || ''); }
    }).catch(err => { if (!disposed) setError(err.response?.data?.error || 'Could not load profiles from the selected router.'); })
      .finally(() => { if (!disposed) setLoadingProfiles(false); });
    return () => { disposed = true; };
  }, [visible, selected, refresh]);
  async function execute() {
    setBusy(true); setError(''); setMessage('');
    const options = { headers: { 'x-isp-server': selected }, timeout: 60000 };
    try {
      if (operation === 'add') await api.post('/pppoe', { username: username.trim(), password, profile }, options);
      if (operation === 'password') await api.put('/pppoe/update/' + encodeURIComponent(username.trim()), { password }, options);
      if (operation === 'remove') await api.delete('/pppoe/remove/' + encodeURIComponent(username.trim()), options);
      setMessage(operation === 'remove' ? 'User removed and active sessions disconnected.' : operation === 'password' ? 'Password updated and verified. Existing sessions retain their current connection.' : 'Local PPPoE user created and verified.');
      setPassword(''); setUsername(''); setConfirm(false);
    } catch (err) {
      const data = err.response?.data;
      setError((data?.error || 'The operation could not be confirmed.') + (data?.outcomeUnknown ? ' The command may have reached the router. Inspect its state before retrying.' : ''));
      setConfirm(false);
    } finally { setBusy(false); }
  }
  const canManage = ['owner', 'admin'].includes(role);
  const content = <>
    <p className="network-note">Manage local RouterOS PPP secrets on one selected router. For RADIUS-managed subscribers, change access in your RADIUS service instead.</p>
    <div className="network-select"><Field label="PPPoE router"><select value={selected || ''} disabled={busy} onChange={event => setSelected(event.target.value)}><option value="">Select a router</option>{servers.map(row => <option key={row.id || row._id} value={row.id || row._id}>{row.name}</option>)}</select></Field></div>
    {!canManage ? <p>Owner or administrator access is required to modify PPPoE users.</p> : <>
      <nav className="network-tabs" aria-label="PPPoE operations">{[['add', 'Add user'], ['password', 'Change password'], ['remove', 'Remove user']].map(([value, label]) => <button key={value} className="secondary" disabled={busy} aria-pressed={operation === value} onClick={() => { setOperation(value); setPassword(''); setError(''); setMessage(''); }}>{label}</button>)}</nav>
      <form className="network-form" onSubmit={event => { event.preventDefault(); if (operation === 'remove') setConfirm(true); else execute(); }}>
        <div className="network-form-grid"><Field label="PPPoE username"><input value={username} onChange={event => setUsername(event.target.value)} required maxLength={128} autoComplete="off" /></Field>
        {operation !== 'remove' && <Field label={operation === 'password' ? 'New PPPoE password' : 'PPPoE password'}><input type="password" value={password} onChange={event => setPassword(event.target.value)} required maxLength={256} autoComplete="new-password" /></Field>}
        {operation === 'add' && <Field label="PPP profile"><select value={profile} required disabled={loadingProfiles} onChange={event => setProfile(event.target.value)}><option value="">{loadingProfiles ? 'Loading profiles…' : 'Select a profile'}</option>{profiles.map(row => <option key={row.id || row.name} value={row.name}>{row.name}{row.rateLimit ? ' · ' + row.rateLimit : ''}</option>)}</select></Field>}</div>
        <div className="form-actions"><button type="submit" disabled={busy || !selected || (operation === 'add' && (!profile || loadingProfiles))}>{busy ? 'Applying…' : operation === 'add' ? 'Create local user' : operation === 'password' ? 'Update password' : 'Review removal'}</button>
        {operation === 'add' && <button type="button" className="secondary" disabled={busy || loadingProfiles || !selected} onClick={() => setRefresh(value => value + 1)}>Reload profiles</button>}</div>
      </form>
    </>}
    {error && <div role="alert" className="notice error">{error}</div>}{message && <div role="status" className="notice">{message}</div>}
    <Modal open={confirm} onClose={() => { if (!busy) setConfirm(false); }} title="Remove PPPoE user"><p>Disable and remove {username} from the selected router, disconnecting all matching active sessions?</p><div className="form-actions"><button disabled={busy} onClick={execute}>Confirm user removal</button><button className="secondary" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button></div></Modal>
  </>;
  return standalone ? <main className="workspace-page network-workspace"><header className="workspace-header"><div><span className="eyebrow">SUBSCRIBER ACCESS</span><h1>PPPoE users</h1><p>Create and maintain local subscriber credentials.</p></div></header><section className="workspace-card">{content}</section></main> : <Modal open={isOpen} onClose={onClose} title="PPPoE users">{content}</Modal>;
}
