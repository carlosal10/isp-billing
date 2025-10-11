import React, { useEffect, useState, useCallback, useMemo } from "react";
import { FaTimes } from "react-icons/fa";
import { MdContentCopy } from "react-icons/md";
import { api } from "../lib/apiClient";
import "./SmsSettingsModal.css"; // styles for this modal (ps-* base + sms-* helpers)

export default function SmsSettingsModal({ isOpen, onClose }) {
  const [tab, setTab] = useState("settings"); // settings | templates | paylink
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const [settings, setSettings] = useState({
    enabled: false,
    primaryProvider: "twilio",
    fallbackEnabled: false,
    senderId: "",
    twilio: { accountSid: "", authToken: "", from: "" },
    africastalking: { apiKey: "", username: "", from: "", useSandbox: false },
    textsms: { apiKey: "", partnerId: "", sender: "", baseUrl: "" },
    schedule: { reminder5Days: true, reminder3Days: true, dueWarnHours: 4 },
    autoSendOnCreate: false,
    autoSendOnPlanChange: false,
    autoTemplateType: "payment-link",
  });

  const [templates, setTemplates] = useState([
    {
      type: "payment-link",
      language: "en",
      body:
        "Hi {{name}}, your {{plan_name}} (KES {{amount}}) expires on {{expiry_date}}. Pay: {{payment_link}}",
      active: true,
    },
    {
      type: "reminder-5",
      language: "en",
      body:
        "Reminder: {{plan_name}} for {{name}} due on {{expiry_date}}. Pay: {{payment_link}}",
      active: true,
    },
    {
      type: "reminder-3",
      language: "en",
      body:
        "Heads up: {{plan_name}} due on {{expiry_date}}. Pay: {{payment_link}}",
      active: true,
    },
    {
      type: "reminder-0",
      language: "en",
      body:
        "Final notice: {{plan_name}} expires today ({{expiry_date}}). Pay: {{payment_link}}",
      active: true,
    },
  ]);

  // Paylink helpers
  const [customers, setCustomers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [pick, setPick] = useState({ customerId: "", planId: "", dueAt: "" });
  const [created, setCreated] = useState({ url: "", token: "", shortUrl: "", shortPath: "" });
  const [sendMsg, setSendMsg] = useState("");

  const shortLink = useMemo(() => {
    if (!created) return "";
    if (created.shortUrl) return created.shortUrl;
    if (created.shortPath) {
      if (typeof window !== "undefined" && window.location?.origin) {
        return `${window.location.origin.replace(/\/$/, "")}${created.shortPath}`;
      }
      return created.shortPath;
    }
    return created.url || "";
  }, [created]);

  const longLink = created?.url || "";

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([
        api.get("/sms/settings").catch(() => ({ data: {} })),
        api.get("/sms/templates").catch(() => ({ data: [] })),
      ]);
      if (s.data && Object.keys(s.data).length)
        setSettings((prev) => ({ ...prev, ...s.data }));
      if (Array.isArray(t.data) && t.data.length)
        setTemplates((prev) => mergeTemplates(prev, t.data));
    } catch (e) {
      setMsg(e?.message || "Failed to load SMS settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setMsg("");
    setSendMsg("");
    setCreated({ url: "", token: "", shortUrl: "", shortPath: "" });
    loadAll();
  }, [isOpen, loadAll]);

  function mergeTemplates(base, fromServer) {
    const key = (x) => `${x.type}:${x.language}`;
    const map = new Map(base.map((x) => [key(x), x]));
    for (const item of fromServer)
      map.set(key(item), { ...map.get(key(item)), ...item });
    return Array.from(map.values());
  }

  async function saveSettings() {
    setLoading(true);
    setMsg("");
    try {
      await api.post("/sms/settings", settings);
      setMsg("Settings saved");
    } catch (e) {
      setMsg(e?.message || "Failed to save settings");
    } finally {
      setLoading(false);
    }
  }

  async function saveTemplate(item) {
    setLoading(true);
    setMsg("");
    try {
      await api.post("/sms/templates", {
        type: item.type,
        language: item.language,
        body: item.body,
        active: item.active,
      });
      setMsg(`${item.type} template saved`);
    } catch (e) {
      setMsg(e?.message || "Failed to save template");
    } finally {
      setLoading(false);
    }
  }

  async function loadCatalog() {
    try {
      const [c, p] = await Promise.all([
        api.get("/customers"),
        api.get("/plans"),
      ]);
      setCustomers(Array.isArray(c.data) ? c.data : []);
      setPlans(Array.isArray(p.data) ? p.data : []);
    } catch {
      /* noop */
    }
  }

  useEffect(() => {
    if (tab === "paylink") loadCatalog();
  }, [tab]);

  // Auto-select customer plan
  useEffect(() => {
    if (!pick.customerId) return;
    const c = customers.find((x) => x._id === pick.customerId);
    const planId = c?.plan?._id || c?.plan || "";
    setPick((prev) => ({ ...prev, planId: planId || "" }));
  }, [pick.customerId, customers]);

  async function createPaylink() {
    setLoading(true);
    setMsg("");
    setCreated({ url: "", token: "", shortUrl: "", shortPath: "" });
    try {
      const { data } = await api.post("/paylink/admin/create", pick);
      setCreated(data || {});
    } catch (e) {
      setMsg(e?.message || "Failed to create paylink");
    } finally {
      setLoading(false);
    }
  }

  async function sendPaymentLink() {
    setLoading(true);
    setSendMsg("");
    try {
      await api.post("/sms/send", {
        customerId: pick.customerId,
        planId: pick.planId,
        templateType: "payment-link",
        dueAt: pick.dueAt || undefined,
      });
      setSendMsg("Payment link SMS sent");
    } catch (e) {
      setSendMsg(e?.message || "Failed to send SMS");
    } finally {
      setLoading(false);
    }
  }

  const copyLink = useCallback(async (link) => {
    if (!link) {
      setMsg("Nothing to copy");
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const el = document.createElement("textarea");
        el.value = link;
        el.setAttribute("readonly", "");
        el.style.position = "absolute";
        el.style.left = "-9999px";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setMsg("Paylink copied to clipboard");
    } catch (e) {
      setMsg(e?.message || "Unable to copy link");
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className="ps-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className="ps-modal">
        {/* Close */}
        <button onClick={onClose} className="ps-close" aria-label="Close">
          <FaTimes size={18} />
        </button>

        {/* Header */}
        <header className="ps-head">
          <span className="ps-chip">Messaging</span>
          <h2>SMS & Paylinks</h2>
        </header>

        {/* Tabs */}
        <div className="ps-tabs">
          {["settings", "templates", "paylink"].map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`ps-tab ${tab === k ? "active" : ""}`}
              type="button"
            >
              {k[0].toUpperCase() + k.slice(1)}
            </button>
          ))}
        </div>

        {/* Status */}
        {msg && (
          <p
            className={`ps-msg ${
              /saved|sent|created|success/i.test(msg) ? "ok" : "err"
            }`}
          >
            {msg}
          </p>
        )}
        {loading && <p className="ps-loading">Working…</p>}

        {/* Body */}
        <div className="ps-form">
          {/* SETTINGS TAB */}
          {tab === "settings" && (
            <div className="sms-section">
              <div className="sms-row">
                <label className="sms-check">
                  <input
                    type="checkbox"
                    checked={settings.enabled}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, enabled: e.target.checked }))
                    }
                  />
                  <span>Enable SMS</span>
                </label>
              </div>

              <div className="ps-grid">
                <div>
                    <label className="ps-subtitle" htmlFor="primaryProvider">
                      Primary Provider
                    </label>
                    <select
                      id="primaryProvider"
                      className="ps-input"
                      value={settings.primaryProvider}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          primaryProvider: e.target.value,
                        }))
                      }
                    >
                    <option value="twilio">Twilio</option>
                    <option value="africastalking">Africa's Talking</option>
                    <option value="textsms">TextSms</option>
                    </select>
                </div>
                <div>
                  <label className="ps-subtitle" htmlFor="senderId">
                    Sender ID
                  </label>
                  <input
                    id="senderId"
                    className="ps-input"
                    value={settings.senderId || ""}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, senderId: e.target.value }))
                    }
                    placeholder="SENDERID"
                  />
                </div>
                <div className="sms-align-end">
                  <label className="sms-check">
                    <input
                      type="checkbox"
                      checked={!!settings.fallbackEnabled}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          fallbackEnabled: e.target.checked,
                        }))
                      }
                    />
                    <span>Enable fallback to secondary</span>
                  </label>
                </div>
              </div>

              {/* Twilio */}
              {(() => {
                const disabled = settings.primaryProvider !== "twilio";
                return (
                  <div className={`sms-card ${disabled ? "is-disabled" : ""}`}>
                    <div className="sms-card-head">
                      <h3 className="sms-card-title">Twilio</h3>
                      {disabled && (
                        <span className="sms-muted">Disabled (not selected)</span>
                      )}
                    </div>
                    <div className="ps-grid">
                      <input
                        className="ps-input"
                        disabled={disabled}
                        placeholder="Account SID"
                        value={settings.twilio?.accountSid || ""}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            twilio: { ...s.twilio, accountSid: e.target.value },
                          }))
                        }
                      />
                      <input
                        className="ps-input"
                        disabled={disabled}
                        placeholder="Auth Token"
                        value={settings.twilio?.authToken || ""}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            twilio: { ...s.twilio, authToken: e.target.value },
                          }))
                        }
                      />
                      <input
                        className="ps-input"
                        disabled={disabled}
                        placeholder="From"
                        value={settings.twilio?.from || ""}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            twilio: { ...s.twilio, from: e.target.value },
                          }))
                        }
                      />
                    </div>
                  </div>
                );
              })()}

              {/* Africa's Talking */}
              {(() => {
                const disabled = settings.primaryProvider !== "africastalking";
                return (
                  <div className={`sms-card ${disabled ? "is-disabled" : ""}`}>
                    <div className="sms-card-head">
                      <h3 className="sms-card-title">Africa&apos;s Talking</h3>
                      {disabled && (
                        <span className="sms-muted">Disabled (not selected)</span>
                      )}
                    </div>
                    <div className="ps-grid">
                      <input
                        className="ps-input"
                        disabled={disabled}
                        placeholder="API Key"
                        value={settings.africastalking?.apiKey || ""}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            africastalking: {
                              ...s.africastalking,
                              apiKey: e.target.value,
                            },
                          }))
                        }
                      />
                      <input
                        className="ps-input"
                        disabled={disabled}
                        placeholder="Username"
                        value={settings.africastalking?.username || ""}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            africastalking: {
                              ...s.africastalking,
                              username: e.target.value,
                            },
                          }))
                        }
                      />
                      <input
                        className="ps-input"
                        disabled={disabled}
                        placeholder="From (Sender)"
                        value={settings.africastalking?.from || ""}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            africastalking: {
                              ...s.africastalking,
                              from: e.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                    <label className="sms-check mt-8">
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={!!settings.africastalking?.useSandbox}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            africastalking: {
                              ...s.africastalking,
                              useSandbox: e.target.checked,
                            },
                          }))
                        }
                      />
                      <span>Use Africa&apos;s Talking Sandbox</span>
                    </label>
                  </div>
                );
              })()}

              {/* TextSms */}
              {(() => {
                const disabled = settings.primaryProvider !== "textsms";
                return (
                  <div className={`sms-card ${disabled ? "is-disabled" : ""}`}>
                    <div className="sms-card-head">
                      <h3 className="sms-card-title">TextSms</h3>
                      {disabled && (
                        <span className="sms-muted">Disabled (not selected)</span>
                      )}
                    </div>
                    <div className="ps-grid">
                      <input
                        className="ps-input"
                        disabled={disabled}
                        placeholder="API Key"
                        value={settings.textsms?.apiKey || ""}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            textsms: {
                              ...s.textsms,
                              apiKey: e.target.value,
                            },
                          }))
                        }
                      />
                      <input
                        className="ps-input"
                        disabled={disabled}
                        placeholder="Partner ID"
                        value={settings.textsms?.partnerId || ""}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            textsms: {
                              ...s.textsms,
                              partnerId: e.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="ps-grid mt-8">
                      <input
                        className="ps-input"
                        disabled={disabled}
                        placeholder="Sender / Shortcode"
                        value={settings.textsms?.sender || ""}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            textsms: {
                              ...s.textsms,
                              sender: e.target.value,
                            },
                          }))
                        }
                      />
                      <input
                        className="ps-input"
                        disabled={disabled}
                        placeholder="API URL"
                        value={settings.textsms?.baseUrl || ""}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            textsms: {
                              ...s.textsms,
                              baseUrl: e.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                  </div>
                );
              })()}

              {/* Reminder Schedule */}
              <div className="sms-card">
                <h3 className="sms-card-title">Reminder Schedule</h3>
                <div className="ps-grid">
                  <label className="sms-check">
                    <input
                      type="checkbox"
                      checked={settings.schedule?.reminder5Days}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          schedule: {
                            ...s.schedule,
                            reminder5Days: e.target.checked,
                          },
                        }))
                      }
                    />
                    <span>T-5 days</span>
                  </label>
                  <label className="sms-check">
                    <input
                      type="checkbox"
                      checked={settings.schedule?.reminder3Days}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          schedule: {
                            ...s.schedule,
                            reminder3Days: e.target.checked,
                          },
                        }))
                      }
                    />
                    <span>T-3 days</span>
                  </label>
                  <div>
                    <label className="ps-subtitle" htmlFor="warnHours">
                      T-0 warn hours
                    </label>
                    <input
                      id="warnHours"
                      type="number"
                      min="1"
                      className="ps-input"
                      value={settings.schedule?.dueWarnHours || 4}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          schedule: {
                            ...s.schedule,
                            dueWarnHours: Number(e.target.value) || 4,
                          },
                        }))
                      }
                    />
                  </div>
                </div>
              </div>

              {/* Auto-send toggles */}
              <div className="ps-grid">
                <label className="sms-check">
                  <input
                    type="checkbox"
                    checked={settings.autoSendOnCreate}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        autoSendOnCreate: e.target.checked,
                      }))
                    }
                  />
                  <span>Auto send paylink on customer creation</span>
                </label>
                <label className="sms-check">
                  <input
                    type="checkbox"
                    checked={settings.autoSendOnPlanChange}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        autoSendOnPlanChange: e.target.checked,
                      }))
                    }
                  />
                  <span>Auto send paylink when plan changes</span>
                </label>
                <div>
                  <label className="ps-subtitle" htmlFor="autoTpl">
                    Auto-send template
                  </label>
                  <select
                    id="autoTpl"
                    className="ps-input"
                    value={settings.autoTemplateType}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        autoTemplateType: e.target.value,
                      }))
                    }
                  >
                    <option value="payment-link">payment-link</option>
                    <option value="reminder-5">reminder-5</option>
                    <option value="reminder-3">reminder-3</option>
                    <option value="reminder-0">reminder-0</option>
                  </select>
                </div>
              </div>

              <button
                onClick={saveSettings}
                className="ps-submit"
                type="button"
              >
                Save
              </button>
            </div>
          )}

          {/* TEMPLATES TAB */}
          {tab === "templates" && (
            <div className="sms-section">
              {templates.map((t, idx) => (
                <div className="sms-card" key={`${t.type}:${t.language}:${idx}`}>
                  <div className="sms-card-head">
                    <div className="sms-card-title">
                      {t.type} <span className="sms-muted">({t.language})</span>
                    </div>
                    <label className="sms-check">
                      <input
                        type="checkbox"
                        checked={!!t.active}
                        onChange={(e) =>
                          setTemplates((arr) =>
                            arr.map((x, i) =>
                              i === idx ? { ...x, active: e.target.checked } : x
                            )
                          )
                        }
                      />
                      <span>Active</span>
                    </label>
                  </div>

                  <textarea
                    rows={3}
                    className="ps-input sms-textarea"
                    value={t.body}
                    onChange={(e) =>
                      setTemplates((arr) =>
                        arr.map((x, i) =>
                          i === idx ? { ...x, body: e.target.value } : x
                        )
                      )
                    }
                  />

                  <div className="sms-actions">
                    <button
                      onClick={() => saveTemplate(templates[idx])}
                      className="ps-tab"
                      type="button"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* PAYLINK TAB */}
          {tab === "paylink" && (
            <div className="sms-section">
              <div className="ps-grid">
                <div>
                  <label className="ps-subtitle" htmlFor="plCustomer">
                    Customer
                  </label>
                  <select
                    id="plCustomer"
                    className="ps-input"
                    value={pick.customerId}
                    onChange={(e) =>
                      setPick((p) => ({ ...p, customerId: e.target.value }))
                    }
                  >
                    <option value="">Select customer</option>
                    {customers.map((c) => (
                      <option key={c._id} value={c._id}>
                        {c.name} ({c.accountNumber})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="ps-subtitle">Plan (from customer)</label>
                  <div className="ps-input sms-readonly">
                    {(() => {
                      const c = customers.find((x) => x._id === pick.customerId);
                      const plan = c?.plan || plans.find((pl) => pl._id === pick.planId);
                      return plan
                        ? `${plan.name} (KES ${plan.price})`
                        : "No plan assigned";
                    })()}
                  </div>
                </div>

                <div>
                  <label className="ps-subtitle" htmlFor="plDue">
                    Due Date
                  </label>
                  <input
                    id="plDue"
                    type="date"
                    className="ps-input"
                    value={pick.dueAt}
                    onChange={(e) =>
                      setPick((p) => ({ ...p, dueAt: e.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="sms-actions">
                <button
                  className="ps-tab"
                  type="button"
                  onClick={createPaylink}
                  disabled={!pick.customerId || !pick.planId}
                >
                  Create Paylink
                </button>
                <button
                  className="ps-submit"
                  type="button"
                  onClick={sendPaymentLink}
                  disabled={!pick.customerId || !pick.planId}
                >
                  Send via SMS
                </button>
              </div>

              {shortLink && (
                <div className="sms-card">
                  <div className="sms-muted">Paylink</div>
                  <div className="sms-break" title={shortLink}>{shortLink}</div>
                  <div className="sms-card-actions">
                    <button
                      type="button"
                      className="ps-tab"
                      onClick={() => copyLink(shortLink)}
                    >
                      <MdContentCopy size={16} /> Copy short link
                    </button>
                    {longLink && longLink !== shortLink && (
                      <button
                        type="button"
                        className="ps-tab ghost"
                        onClick={() => copyLink(longLink)}
                      >
                        Copy full URL
                      </button>
                    )}
                  </div>
                </div>
              )}

              {sendMsg && (
                <div
                  className={`ps-msg ${
                    /sent/i.test(sendMsg) ? "ok" : "err"
                  }`}
                >
                  {sendMsg}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
