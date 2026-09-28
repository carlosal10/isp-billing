import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { portalApi } from '../lib/apiClient';
import { Field } from '../components/ui/Field';
import './Login.css';

export default function PortalSetup() {
  const [form, setForm] = useState({ tenantName: '', accountNumber: '', code: '', newPin: '' });
  const [challengeId, setChallengeId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const field = (name) => ({ value: form[name], onChange: e => setForm({ ...form, [name]: e.target.value }) });
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const { data } = await portalApi.post(challengeId ? '/auth/challenge/complete' : '/auth/challenge',
        challengeId ? { challengeId, code: form.code, newPin: form.newPin } : { tenantName: form.tenantName, accountNumber: form.accountNumber });
      setMessage(data.message);
      if (challengeId) setDone(true); else setChallengeId(data.challengeId);
    } catch (err) { setError(err.response?.data?.error || 'Unable to verify your account. Please try again.'); }
    finally { setBusy(false); }
  }
  return <main className="portal-setup-shell">
    <Link to="/login?mode=customer" className="back-link">← Back to sign in</Link>
    <section className="portal-setup-card">
      <span className="eyebrow">CUSTOMER ACCESS</span>
      <h1>{done ? 'Your PIN is ready' : challengeId ? 'Verify your account' : 'Set up your portal PIN'}</h1>
      <p>Use a code sent to your registered phone to create or reset your PIN. If you cannot receive messages, contact your ISP.</p>
      {message && <p role="status" className="notice">{message}</p>}
      {error && <p role="alert" className="ui-field-error">{error}</p>}
      {!done && <form onSubmit={submit} className="stacked-form">
        {!challengeId ? <>
          <Field label="ISP workspace"><input {...field('tenantName')} required maxLength={120} autoComplete="organization" /></Field>
          <Field label="Account number"><input {...field('accountNumber')} required maxLength={120} autoComplete="username" /></Field>
        </> : <>
          <Field label="Verification code" hint="Enter the six-digit code. It expires after 10 minutes."><input {...field('code')} required pattern="[0-9]{6}" inputMode="numeric" autoComplete="one-time-code" maxLength={6} /></Field>
          <Field label="New PIN" hint="Choose 6 to 8 digits."><input {...field('newPin')} type="password" required pattern="[0-9]{6,8}" inputMode="numeric" autoComplete="new-password" maxLength={8} /></Field>
        </>}
        <div className="form-actions"><button type="submit" disabled={busy}>{busy ? 'Please wait…' : challengeId ? 'Verify and save PIN' : 'Send verification code'}</button>
          {challengeId && <button type="button" className="secondary" onClick={() => { setChallengeId(''); setMessage(''); }}>Start again</button>}</div>
      </form>}
      {done && <Link className="btn" to="/login?mode=customer">Sign in to your account</Link>}
    </section>
  </main>;
}
