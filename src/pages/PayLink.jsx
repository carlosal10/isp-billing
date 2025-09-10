import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/apiClient';
import './PayLink.css';

function useQuery() {
  return useMemo(() => new URLSearchParams(window.location.search), []);
}

export default function PayLink() {
  const q = useQuery();
  const token = q.get('token');
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError(''); setMessage('');
      try {
        const res = await api.get('/paylink/info', { params: { token } });
        if (!active) return;
        setInfo(res.data);
      } catch (e) {
        if (!active) return;
        setError(e?.message || 'Failed to load');
      } finally {
        if (active) setLoading(false);
      }
    }
    if (token) load(); else { setError('Missing token'); setLoading(false); }
    return () => { active = false; };
  }, [token]);

  const plan = info?.plan;
  const otherPlans = (info?.otherPlans || []).filter(p => p._id !== plan?._id);

  async function pay() {
    if (!token || !phone) return;
    setSending(true); setMessage(''); setError('');
    try {
      await api.post('/paylink/stk', { token, phone });
      setMessage('Payment request sent. Check your phone to approve.');
    } catch (e) {
      setError(e?.message || 'Failed to initiate payment');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="pay-wrap">
      <nav className="pay-nav">
        <div className="pay-brand">KT-SwiftBridge</div>
        <div className="pay-secure">Secure Checkout</div>
      </nav>

      <main className="pay-main">
        <section className="pitch">
          <h1>Fast, secure payments for your internet plan.</h1>
          <p>Settle your subscription in seconds with STK-Push. Simple, safe, and powered by KT‑SwiftBridge.</p>
          <div className="trust"><span className="dot" /> Trusted by growing ISPs</div>
        </section>

        <section className="pay-card">
          <h2>Subscription Payment</h2>
          <div className="sub">Pay for your selected plan</div>
          {loading && <p>Loading plan details...</p>}
          {error && <p className="msg-err">{error}</p>}

          {info && (
            <div>
              <div className="pay-field">
                <div className="sub">Customer</div>
                <div style={{ fontWeight: 700 }}>{info.customer?.name || 'Customer'}</div>
              </div>

              <div className="plan-box">
                <div className="plan-top">
                  <div>
                    <div className="plan-name">{plan?.name}</div>
                    <div className="plan-desc">{plan?.description}</div>
                  </div>
                  <div className="plan-price">KES {plan?.price}</div>
                </div>
                <div className="plan-meta">Expiry: {new Date(info.dueAt).toLocaleDateString()}</div>
              </div>

              <div className="pay-field">
                <label htmlFor="phone">Pay from phone number</label>
                <input id="phone" className="pay-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 07XXXXXXXX" />
              </div>
              <button className="pay-btn" onClick={pay} disabled={sending || !phone}>
                {sending ? 'Sending...' : `Pay KES ${plan?.price} via M-Pesa`}
              </button>

              {message && <p className="msg-ok">{message}</p>}
            </div>
          )}

          {!!otherPlans.length && (
            <div className="other">
              <h3>Other Plans</h3>
              <div className="other-grid">
                {otherPlans.map(p => (
                  <div key={p._id} className="other-item">
                    <div className="nm">{p.name}</div>
                    <div className="ds">{p.description}</div>
                    <div className="pr">KES {p.price}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>

      <footer className="pay-footer">Payments are processed securely. Need help? Contact your ISP.</footer>
    </div>
  );
}
