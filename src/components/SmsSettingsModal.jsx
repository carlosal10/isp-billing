import React, { useEffect, useState, useCallback } from 'react';
import { FaTimes } from 'react-icons/fa';
import { api } from '../lib/apiClient';

export default function SmsSettingsModal({ isOpen, onClose }) {
  const [tab, setTab] = useState('settings'); // settings | templates | paylink
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const [settings, setSettings] = useState({
    enabled: false,
    primaryProvider: 'twilio',
    fallbackEnabled: false,
    senderId: '',
    twilio: { accountSid: '', authToken: '', from: '' },
    africastalking: { apiKey: '', username: '', from: '' },
    schedule: { reminder5Days: true, reminder3Days: true, dueWarnHours: 4 },
    autoSendOnCreate: false,
    autoSendOnPlanChange: false,
    autoTemplateType: 'payment-link',
  });

  const [templates, setTemplates] = useState([
    { type: 'payment-link', language: 'en', body: 'Hi {{name}}, your {{plan_name}} (KES {{amount}}) expires on {{expiry_date}}. Pay: {{payment_link}}', active: true },
    { type: 'reminder-5', language: 'en', body: 'Reminder: {{plan_name}} for {{name}} due on {{expiry_date}}. Pay: {{payment_link}}', active: true },
    { type: 'reminder-3', language: 'en', body: 'Heads up: {{plan_name}} due on {{expiry_date}}. Pay: {{payment_link}}', active: true },
    { type: 'reminder-0', language: 'en', body: 'Final notice: {{plan_name}} expires today ({{expiry_date}}). Pay: {{payment_link}}', active: true },
  ]);

  // Paylink helpers
  const [customers, setCustomers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [pick, setPick] = useState({ customerId: '', planId: '', dueAt: '' });
  const [created, setCreated] = useState({ url: '', token: '' });
  const [sendMsg, setSendMsg] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([
        api.get('/sms/settings').catch(() => ({ data: {} })),
        api.get('/sms/templates').catch(() => ({ data: [] })),
      ]);
      if (s.data && Object.keys(s.data).length) setSettings((prev) => ({ ...prev, ...s.data }));
      if (Array.isArray(t.data) && t.data.length) setTemplates(prev => mergeTemplates(prev, t.data));
    } catch (e) {
      setMsg(e?.message || 'Failed to load SMS settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setMsg(''); setSendMsg(''); setCreated({ url: '', token: '' });
    loadAll();
  }, [isOpen, loadAll]);

  function mergeTemplates(base, fromServer) {
    const key = (x) => `${x.type}:${x.language}`;
    const map = new Map(base.map((x) => [key(x), x]));
    for (const item of fromServer) map.set(key(item), { ...map.get(key(item)), ...item });
    return Array.from(map.values());
  }

  async function saveSettings() {
    setLoading(true); setMsg('');
    try {
      await api.post('/sms/settings', settings);
      setMsg('Settings saved');
    } catch (e) {
      setMsg(e?.message || 'Failed to save settings');
    } finally { setLoading(false); }
  }

  async function saveTemplate(item) {
    setLoading(true); setMsg('');
    try {
      await api.post('/sms/templates', { type: item.type, language: item.language, body: item.body, active: item.active });
      setMsg(`${item.type} template saved`);
    } catch (e) { setMsg(e?.message || 'Failed to save template'); }
    finally { setLoading(false); }
  }

  async function loadCatalog() {
    try {
      const [c, p] = await Promise.all([
        api.get('/customers'), // includes populated plan
        api.get('/plans'),
      ]);
      setCustomers(Array.isArray(c.data) ? c.data : []);
      setPlans(Array.isArray(p.data) ? p.data : []);
    } catch {}
  }

  useEffect(() => { if (tab === 'paylink') loadCatalog(); }, [tab]);

  // Auto-select customer's assigned plan when customer changes
  useEffect(() => {
    if (!pick.customerId) return;
    const c = customers.find(x => x._id === pick.customerId);
    const planId = c?.plan?._id || c?.plan || '';
    setPick(prev => ({ ...prev, planId: planId || '' }));
  }, [pick.customerId, customers]);

  async function createPaylink() {
    setLoading(true); setMsg(''); setCreated({ url: '', token: '' });
    try {
      const { data } = await api.post('/paylink/admin/create', pick);
      setCreated(data || {});
    } catch (e) { setMsg(e?.message || 'Failed to create paylink'); }
    finally { setLoading(false); }
  }

  async function sendPaymentLink() {
    setLoading(true); setSendMsg('');
    try {
      await api.post('/sms/send', { customerId: pick.customerId, planId: pick.planId, templateType: 'payment-link', dueAt: pick.dueAt || undefined });
      setSendMsg('Payment link SMS sent');
    } catch (e) { setSendMsg(e?.message || 'Failed to send SMS'); }
    finally { setLoading(false); }
  }

  if (!isOpen) return null;

  return (
    <div className="modal-overlay fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
      <div className="modal-content bg-white rounded-2xl shadow-lg w-full max-w-3xl p-6 relative">
        <button onClick={onClose} className="absolute top-3 right-3 text-gray-600 hover:text-red-500" aria-label="Close">
          <FaTimes size={20} />
        </button>
        <h2 className="text-2xl font-bold mb-2">SMS & Paylinks</h2>

        {msg && <p className="text-sm mb-2" style={{ color: msg.includes('saved') ? '#065f46' : '#c53030' }}>{msg}</p>}
        {loading && <p className="text-sm text-gray-500 mb-2">Working...</p>}

        <div className="flex space-x-4 border-b mb-4">
          {['settings','templates','paylink'].map(k => (
            <button key={k} onClick={() => setTab(k)} className={`pb-2 ${tab===k? 'border-b-2 border-green-600 text-green-600 font-semibold':'text-gray-600'}`}>{k[0].toUpperCase()+k.slice(1)}</button>
          ))}
        </div>

        {tab === 'settings' && (
          <div className="space-y-3">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={settings.enabled} onChange={(e)=>setSettings(s=>({...s, enabled: e.target.checked}))} /> Enable SMS
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div>
                <label className="block text-sm">Primary Provider</label>
                <select value={settings.primaryProvider} onChange={(e)=>setSettings(s=>({...s, primaryProvider: e.target.value}))} className="w-full border rounded px-3 py-2">
                  <option value="twilio">Twilio</option>
                  <option value="africastalking">Africa's Talking</option>
                </select>
              </div>
              <div>
                <label className="block text-sm">Sender ID</label>
                <input value={settings.senderId||''} onChange={(e)=>setSettings(s=>({...s, senderId: e.target.value}))} className="w-full border rounded px-3 py-2" />
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!settings.fallbackEnabled}
                  onChange={(e)=>setSettings(s=>({...s, fallbackEnabled: e.target.checked}))}
                />
                <span className="text-sm">Enable fallback to secondary</span>
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings.autoSendOnCreate} onChange={(e)=>setSettings(s=>({...s, autoSendOnCreate: e.target.checked}))} />
                Auto send paylink on customer creation
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings.autoSendOnPlanChange} onChange={(e)=>setSettings(s=>({...s, autoSendOnPlanChange: e.target.checked}))} />
                Auto send paylink when plan changes
              </label>
              <div>
                <label className="block text-sm">Auto-send template</label>
                <select value={settings.autoTemplateType} onChange={(e)=>setSettings(s=>({...s, autoTemplateType: e.target.value}))} className="w-full border rounded px-3 py-2">
                  <option value="payment-link">payment-link</option>
                  <option value="reminder-5">reminder-5</option>
                  <option value="reminder-3">reminder-3</option>
                  <option value="reminder-0">reminder-0</option>
                </select>
              </div>
            </div>

            {(() => {
              const twilioDisabled = settings.primaryProvider !== 'twilio';
              return (
                <div className={twilioDisabled ? 'opacity-50' : ''}>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Twilio</h3>
                    {twilioDisabled && <span className="text-xs text-gray-500">Disabled (not selected)</span>}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <input disabled={twilioDisabled} placeholder="Account SID" value={settings.twilio?.accountSid||''} onChange={(e)=>setSettings(s=>({...s, twilio:{...s.twilio, accountSid: e.target.value}}))} className="w-full border rounded px-3 py-2" />
                    <input disabled={twilioDisabled} placeholder="Auth Token" value={settings.twilio?.authToken||''} onChange={(e)=>setSettings(s=>({...s, twilio:{...s.twilio, authToken: e.target.value}}))} className="w-full border rounded px-3 py-2" />
                    <input disabled={twilioDisabled} placeholder="From" value={settings.twilio?.from||''} onChange={(e)=>setSettings(s=>({...s, twilio:{...s.twilio, from: e.target.value}}))} className="w-full border rounded px-3 py-2" />
                  </div>
                </div>
              );
            })()}

            {(() => {
              const atDisabled = settings.primaryProvider !== 'africastalking';
              return (
                <div className={atDisabled ? 'opacity-50' : ''}>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Africa's Talking</h3>
                    {atDisabled && <span className="text-xs text-gray-500">Disabled (not selected)</span>}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <input disabled={atDisabled} placeholder="API Key" value={settings.africastalking?.apiKey||''} onChange={(e)=>setSettings(s=>({...s, africastalking:{...s.africastalking, apiKey: e.target.value}}))} className="w-full border rounded px-3 py-2" />
                    <input disabled={atDisabled} placeholder="Username" value={settings.africastalking?.username||''} onChange={(e)=>setSettings(s=>({...s, africastalking:{...s.africastalking, username: e.target.value}}))} className="w-full border rounded px-3 py-2" />
                    <input disabled={atDisabled} placeholder="From (Sender)" value={settings.africastalking?.from||''} onChange={(e)=>setSettings(s=>({...s, africastalking:{...s.africastalking, from: e.target.value}}))} className="w-full border rounded px-3 py-2" />
                  </div>
                </div>
              );
            })()}

            <div>
              <h3 className="font-semibold">Reminder Schedule</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
                <label className="flex items-center gap-2"><input type="checkbox" checked={settings.schedule?.reminder5Days} onChange={(e)=>setSettings(s=>({...s, schedule:{...s.schedule, reminder5Days: e.target.checked}}))}/> T-5 days</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={settings.schedule?.reminder3Days} onChange={(e)=>setSettings(s=>({...s, schedule:{...s.schedule, reminder3Days: e.target.checked}}))}/> T-3 days</label>
                <div>
                  <label className="block text-sm">T-0 warn hours</label>
                  <input type="number" min="1" value={settings.schedule?.dueWarnHours||4} onChange={(e)=>setSettings(s=>({...s, schedule:{...s.schedule, dueWarnHours: Number(e.target.value)||4}}))} className="w-full border rounded px-3 py-2" />
                </div>
              </div>
            </div>

            <button onClick={saveSettings} className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700">Save</button>
          </div>
        )}

        {tab === 'templates' && (
          <div className="space-y-4">
            {templates.map((t, idx) => (
              <div key={`${t.type}:${t.language}:${idx}`} className="border rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold">{t.type} ({t.language})</div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!t.active} onChange={(e)=>setTemplates(arr=>arr.map((x,i)=>i===idx?{...x, active:e.target.checked}:x))} /> Active
                  </label>
                </div>
                <textarea value={t.body} onChange={(e)=>setTemplates(arr=>arr.map((x,i)=>i===idx?{...x, body:e.target.value}:x))} rows={3} className="w-full border rounded px-3 py-2" />
                <div className="mt-2 flex gap-2">
                  <button onClick={()=>saveTemplate(templates[idx])} className="bg-green-600 text-white px-3 py-1 rounded">Save</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'paylink' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm">Customer</label>
                <select value={pick.customerId} onChange={(e)=>setPick(p=>({...p, customerId:e.target.value}))} className="w-full border rounded px-3 py-2">
                  <option value="">Select customer</option>
                  {customers.map(c => (
                    <option key={c._id} value={c._id}>{c.name} ({c.accountNumber})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm">Plan (from customer)</label>
                <div className="w-full border rounded px-3 py-2 bg-gray-50">
                  {(() => {
                    const c = customers.find(x => x._id === pick.customerId);
                    const plan = c?.plan || plans.find(pl => pl._id === pick.planId);
                    return plan ? `${plan.name} (KES ${plan.price})` : 'No plan assigned';
                  })()}
                </div>
              </div>
              <div>
                <label className="block text-sm">Due Date</label>
                <input type="date" value={pick.dueAt} onChange={(e)=>setPick(p=>({...p, dueAt:e.target.value}))} className="w-full border rounded px-3 py-2" />
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={createPaylink} disabled={!pick.customerId || !pick.planId} className="bg-blue-600 text-white px-4 py-2 rounded">Create Paylink</button>
              <button onClick={sendPaymentLink} disabled={!pick.customerId || !pick.planId} className="bg-green-600 text-white px-4 py-2 rounded">Send via SMS</button>
            </div>
            {created.url && (
              <div className="p-3 border rounded"><div className="text-sm text-gray-600">Paylink</div><div className="break-all">{created.url}</div></div>
            )}
            {sendMsg && <div className="text-sm" style={{ color: sendMsg.includes('sent') ? '#065f46':'#c53030' }}>{sendMsg}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
