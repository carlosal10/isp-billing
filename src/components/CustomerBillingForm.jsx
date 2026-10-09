import React, { useState } from 'react';
import { Field } from './ui/Field';
export default function CustomerBillingForm({ customer, plans, busy, onSave, onCancel }) {
  const [draft, setDraft] = useState(() => ({ name: customer?.name || '', email: customer?.email || '', phone: customer?.phone || '', address: customer?.address || '', accountNumber: customer?.accountNumber || '',
    plan: customer?.plan?._id || customer?.plan || '', connectionType: customer?.connectionType || 'pppoe',
    billingProfile: { invoiceLeadDays: 3, autopayEnabled: false, preferredPaymentMethod: 'mpesa', graceDays: 3, retryIntervalDays: 2, maxAutopayAttempts: 3, ...customer?.billingProfile } }));
  const update = (key, value) => setDraft(d => ({ ...d, [key]: value }));
  const billing = (key, value) => setDraft(d => ({ ...d, billingProfile: { ...d.billingProfile, [key]: value } }));
  return <form className="network-form" onSubmit={e => { e.preventDefault(); onSave(draft); }}>
    <p className="network-note">Save the customer’s billing record, then add or link their network service. Saving this form does not modify router accounts. Changing the billing plan does not change the router profile.</p>
    <div className="network-form-grid">
      {[['name', 'Full name'], ['email', 'Email'], ['phone', 'Phone number'], ['address', 'Address']].map(([key, label]) => <Field key={key} label={label}><input required type={key === 'email' ? 'email' : 'text'} value={draft[key]} onChange={e => update(key, e.target.value)} /></Field>)}
      <Field label="Account number" hint="Billing reference; changing it does not rename the router username."><input value={draft.accountNumber} onChange={e => update('accountNumber', e.target.value)} placeholder="Generated when blank" required={!!customer} /></Field>
      <Field label="Billing plan"><select required value={draft.plan} onChange={e => update('plan', e.target.value)}><option value="">Select plan</option>{plans.map(p => <option key={p._id} value={p._id}>{p.name} · {p.price} KES</option>)}</select></Field>
      <Field label="Connection type"><select value={draft.connectionType} onChange={e => update('connectionType', e.target.value)}><option value="pppoe">PPPoE</option><option value="static">Static IP</option><option value="hotspot">Hotspot</option></select></Field>
    </div>
    <fieldset><legend>Billing preferences</legend><div className="network-form-grid">
      <Field label="Preferred payment method"><select value={draft.billingProfile.preferredPaymentMethod} onChange={e => billing('preferredPaymentMethod', e.target.value)}><option value="mpesa">M-Pesa</option><option value="stripe">Stripe</option><option value="manual">Manual</option></select></Field>
      <Field label="Autopay phone"><input value={draft.billingProfile.preferredPhoneNumber || ''} onChange={e => billing('preferredPhoneNumber', e.target.value)} /></Field>
      {[['invoiceLeadDays', 'Invoice lead days'], ['graceDays', 'Grace days'], ['retryIntervalDays', 'Retry interval days'], ['maxAutopayAttempts', 'Maximum autopay attempts']].map(([key, label]) => <Field label={label} key={key}><input type="number" required min={key === 'retryIntervalDays' ? 1 : 0} max={365} value={draft.billingProfile[key]} onChange={e => billing(key, Number(e.target.value))} /></Field>)}
    </div><label className="network-options"><input type="checkbox" checked={draft.billingProfile.autopayEnabled === true} onChange={e => billing('autopayEnabled', e.target.checked)} />Enable autopay</label></fieldset>
    <div className="form-actions"><button disabled={busy} type="submit">{busy ? 'Saving…' : 'Save customer'}</button><button disabled={busy} type="button" className="secondary" onClick={onCancel}>Cancel</button></div>
  </form>;
}
