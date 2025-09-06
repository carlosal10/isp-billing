import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/apiClient';

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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7fafc' }}>
      <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 6px 24px rgba(0,0,0,0.08)', padding: 24, width: '100%', maxWidth: 720 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Subscription Payment</h2>
        {loading && <p>Loading plan details...</p>}
        {error && <p style={{ color: '#c53030' }}>{error}</p>}

        {info && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, color: '#4a5568' }}>Customer</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{info.customer?.name || 'Customer'}</div>
            </div>

            <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{plan?.name}</div>
                  <div style={{ color: '#4a5568', fontSize: 14 }}>{plan?.description}</div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>KES {plan?.price}</div>
              </div>
              <div style={{ marginTop: 8, fontSize: 14, color: '#4a5568' }}>Expiry: {new Date(info.dueAt).toLocaleDateString()}</div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label htmlFor="phone" style={{ display: 'block', fontSize: 14, marginBottom: 6 }}>Pay from phone number</label>
              <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 07XXXXXXXX" style={{ width: '100%', padding: '10px 12px', border: '1px solid #cbd5e0', borderRadius: 8 }} />
            </div>
            <button onClick={pay} disabled={sending || !phone} style={{ width: '100%', background: '#16a34a', color: '#fff', padding: '10px 14px', borderRadius: 8, cursor: 'pointer' }}>
              {sending ? 'Sending...' : `Pay KES ${plan?.price} via M-Pesa`}
            </button>

            {message && <p style={{ color: '#065f46', marginTop: 10 }}>{message}</p>}
          </div>
        )}

        {!!otherPlans.length && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Other plans</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              {otherPlans.map(p => (
                <div key={p._id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
                  <div style={{ fontWeight: 600 }}>{p.name}</div>
                  <div style={{ color: '#4a5568', fontSize: 13 }}>{p.description}</div>
                  <div style={{ marginTop: 6, fontWeight: 700 }}>KES {p.price}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
