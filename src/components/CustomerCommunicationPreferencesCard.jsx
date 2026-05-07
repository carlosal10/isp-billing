import React, { useEffect, useState } from "react";
import { api } from "../lib/apiClient";

function dateTimeLocalValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60 * 1000).toISOString().slice(0, 16);
}

function initialPreferencesFromCustomer(customer) {
  const prefs = customer?.communicationPreferences || {};
  const quiet = prefs.quietHours || {};
  return {
    preferredLanguage: prefs.preferredLanguage || "en",
    transactionalSmsEnabled: prefs.transactionalSmsEnabled !== false,
    billingSmsEnabled: prefs.billingSmsEnabled !== false,
    serviceAlertsSmsEnabled: prefs.serviceAlertsSmsEnabled !== false,
    marketingSmsEnabled: prefs.marketingSmsEnabled === true,
    doNotContactUntil: dateTimeLocalValue(prefs.doNotContactUntil),
    quietHours: {
      enabled: quiet.enabled === true,
      start: quiet.start || "21:00",
      end: quiet.end || "07:00",
      timezone: quiet.timezone || "Africa/Nairobi",
    },
  };
}

export default function CustomerCommunicationPreferencesCard({ customer, onUpdated }) {
  const [form, setForm] = useState(() => initialPreferencesFromCustomer(customer));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!customer?._id) return;
    let cancelled = false;
    setForm(initialPreferencesFromCustomer(customer));
    setMessage("");
    setError("");
    setLoading(true);

    api
      .get(`/customers/${customer._id}/communication-preferences`)
      .then(({ data }) => {
        if (cancelled) return;
        setForm(initialPreferencesFromCustomer({
          communicationPreferences: data?.communicationPreferences || {},
        }));
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || "Failed to load communication preferences");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [customer]);

  if (!customer?._id) return null;

  const setBoolean = (key, checked) => {
    setForm((current) => ({ ...current, [key]: checked }));
  };

  const setQuiet = (key, value) => {
    setForm((current) => ({
      ...current,
      quietHours: { ...current.quietHours, [key]: value },
    }));
  };

  const save = async () => {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const payload = {
        ...form,
        doNotContactUntil: form.doNotContactUntil || null,
      };
      const { data } = await api.put(`/customers/${customer._id}/communication-preferences`, payload);
      const next = data?.preferences || data;
      setForm(initialPreferencesFromCustomer({
        communicationPreferences: next?.communicationPreferences || {},
      }));
      setMessage("Communication preferences saved");
      await onUpdated?.({
        customerId: customer._id,
        communicationPreferences: next?.communicationPreferences || {},
      });
    } catch (err) {
      setError(err?.message || "Failed to save communication preferences");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ border: "1px solid #e6eaf2", borderRadius: 12, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: 4 }}>Communication Preferences</div>
          <div style={{ color: "#64748b", fontSize: 13 }}>
            Consent, quiet hours, and transactional SMS governance for customer-facing messages.
          </div>
        </div>
        <span
          style={{
            display: "inline-flex",
            borderRadius: 999,
            padding: "6px 12px",
            background: form.transactionalSmsEnabled ? "#eafaf1" : "#fee2e2",
            color: form.transactionalSmsEnabled ? "#166534" : "#991b1b",
            border: `1px solid ${form.transactionalSmsEnabled ? "#bbf7d0" : "#fecaca"}`,
            fontWeight: 800,
            whiteSpace: "nowrap",
          }}
        >
          {form.transactionalSmsEnabled ? "Transactional On" : "SMS Suppressed"}
        </span>
      </div>

      {loading ? <div style={{ marginTop: 10 }}>Loading preferences...</div> : null}
      {error ? <div style={{ color: "#b91c1c", marginTop: 10 }}>{error}</div> : null}
      {message ? <div style={{ color: "#166534", marginTop: 10 }}>{message}</div> : null}

      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={form.transactionalSmsEnabled}
              onChange={(event) => setBoolean("transactionalSmsEnabled", event.target.checked)}
            />
            Transactional SMS
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={form.billingSmsEnabled}
              onChange={(event) => setBoolean("billingSmsEnabled", event.target.checked)}
            />
            Billing reminders
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={form.serviceAlertsSmsEnabled}
              onChange={(event) => setBoolean("serviceAlertsSmsEnabled", event.target.checked)}
            />
            Service alerts
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={form.marketingSmsEnabled}
              onChange={(event) => setBoolean("marketingSmsEnabled", event.target.checked)}
            />
            Marketing SMS
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
          <input
            value={form.preferredLanguage}
            onChange={(event) => setForm((current) => ({ ...current, preferredLanguage: event.target.value }))}
            placeholder="Language, e.g. en"
            style={{ padding: "10px 12px", border: "1px solid #e6eaf2", borderRadius: 10 }}
          />
          <input
            type="datetime-local"
            value={form.doNotContactUntil}
            onChange={(event) => setForm((current) => ({ ...current, doNotContactUntil: event.target.value }))}
            title="Do not contact until"
            style={{ padding: "10px 12px", border: "1px solid #e6eaf2", borderRadius: 10 }}
          />
        </div>

        <div style={{ background: "#f8fafc", border: "1px solid #eef2f7", borderRadius: 10, padding: 10 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
            <input
              type="checkbox"
              checked={form.quietHours.enabled}
              onChange={(event) => setQuiet("enabled", event.target.checked)}
            />
            Quiet hours
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8, marginTop: 10 }}>
            <input
              type="time"
              value={form.quietHours.start}
              onChange={(event) => setQuiet("start", event.target.value)}
              style={{ padding: "10px 12px", border: "1px solid #e6eaf2", borderRadius: 10 }}
            />
            <input
              type="time"
              value={form.quietHours.end}
              onChange={(event) => setQuiet("end", event.target.value)}
              style={{ padding: "10px 12px", border: "1px solid #e6eaf2", borderRadius: 10 }}
            />
            <input
              value={form.quietHours.timezone}
              onChange={(event) => setQuiet("timezone", event.target.value)}
              placeholder="Timezone"
              style={{ padding: "10px 12px", border: "1px solid #e6eaf2", borderRadius: 10 }}
            />
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <button className="btn" disabled={saving || loading} onClick={save}>
          {saving ? "Saving..." : "Save Preferences"}
        </button>
      </div>
    </div>
  );
}
