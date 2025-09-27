// src/components/MessagingModal.jsx
import { useEffect, useMemo, useState } from "react";
import { FaTimes } from "react-icons/fa";
import { api } from "../lib/apiClient";

const TEMPLATES = [
  { id: "due_5", label: "Due in 5 days", body: "Hi {name}, your {plan} plan (KES {amount}) is due on {expiry}. Pay via {paylink}. Reply STOP to opt out." },
  { id: "due_3", label: "Due in 3 days", body: "Reminder: {name}, your {plan} (KES {amount}) expires on {expiry}. Tap to renew: {paylink}" },
  { id: "due_today", label: "Due today (final)", body: "Final notice: {name}, your {plan} (KES {amount}) expires today {expiry}. Renew now: {paylink}" },
];

function countSmsSegments(text) {
  const gsm7 =
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ" +
    " !\"#¤%&'()*+,-./0123456789:;<=>?" +
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ`" +
    "¿abcdefghijklmnopqrstuvwxyzäöñüà";
  const isGsm = [...text].every((c) => gsm7.includes(c) || c.charCodeAt(0) < 128);
  const perSeg = isGsm ? 160 : 70;
  const concatPerSeg = isGsm ? 153 : 67;
  if ((text || "").length <= perSeg) return { segments: text ? 1 : 0, perSeg, isGsm };
  return { segments: Math.ceil((text || "").length / concatPerSeg), perSeg: concatPerSeg, isGsm };
}

function replaceTokens(template, vars) {
  return template
    .replaceAll("{name}", vars.name || "")
    .replaceAll("{plan}", vars.plan || "")
    .replaceAll("{amount}", vars.amount != null ? String(vars.amount) : "")
    .replaceAll("{expiry}", vars.expiry || "")
    .replaceAll("{paylink}", vars.paylink || "");
}

export default function MessagingModal({ isOpen, onClose, defaults }) {
  const seed = defaults || {};
  const [channel, setChannel] = useState("sms");
  const [recipient, setRecipient] = useState(seed.recipient || "");
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const [message, setMessage] = useState(
    replaceTokens(TEMPLATES[0].body, {
      name: seed.name,
      plan: seed.plan,
      amount: seed.amount,
      expiry: seed.expiry,
      paylink: seed.paylink,
    })
  );
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    const onEsc = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [isOpen, onClose]);

  const smsInfo = useMemo(() => countSmsSegments(message || ""), [message]);

  const canSend =
    !!recipient.trim() &&
    !!message.trim() &&
    !loading &&
    (channel === "sms" || channel === "email" || channel === "whatsapp");

  function applyTemplate(id) {
    const tpl = TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;
    setTemplateId(id);
    setMessage(
      replaceTokens(tpl.body, {
        name: seed.name,
        plan: seed.plan,
        amount: seed.amount,
        expiry: seed.expiry,
        paylink: seed.paylink,
      })
    );
  }

  async function handleSubmit(e) {
    e?.preventDefault?.();
    setLoading(true);
    setResp("");
    try {
      if (channel === "sms") {
        await api.post("/sms/send-test", { to: recipient.trim(), body: message.trim() });
        setResp("✅ SMS sent successfully.");
      } else if (channel === "email") {
        await api.post("/email/send-test", { to: recipient.trim(), subject: "Notification", html: message.trim() });
        setResp("✅ Email sent successfully.");
      } else {
        await api.post("/whatsapp/send-test", { to: recipient.trim(), body: message.trim() });
        setResp("✅ WhatsApp message sent successfully.");
      }
      setRecipient("");
      setMessage("");
    } catch (err) {
      setResp(`❌ Failed to send via ${channel.toUpperCase()}: ${err?.response?.data?.message || err?.message || "error"}`);
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="ps-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="ps-modal">
        {/* Close */}
        <button onClick={onClose} className="ps-close" aria-label="Close">
          <FaTimes size={18} />
        </button>

        {/* Header */}
        <header className="ps-head">
          <span className="ps-chip">Messaging</span>
          <h2>Send Notification</h2>
        </header>

        {/* Channel Tabs */}
        <div className="ps-tabs">
          {["sms", "email", "whatsapp"].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChannel(c)}
              className={`ps-tab ${channel === c ? "active" : ""}`}
            >
              {c.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Flash messages */}
        {resp && (
          <p className={`ps-msg ${resp.startsWith("✅") ? "ok" : "err"}`} role="status">
            {resp}
          </p>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="ps-form">
          <h3 className="ps-subtitle">Compose</h3>

          {/* Recipient + Template */}
          <div className="ps-grid">
            {/* Recipient */}
            <div>
              <label className="ps-subtitle" style={{ fontSize: ".9rem" }}>
                Recipient
              </label>
              <input
                className="ps-input"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder={
                  channel === "sms"
                    ? "07XXXXXXXX or +2547XXXXXXX"
                    : channel === "email"
                    ? "user@example.com"
                    : "WhatsApp: +2547XXXXXXX"
                }
                required
              />
              <div style={{ fontSize: ".75rem", color: "#64748b", marginTop: 6 }}>
                {channel === "sms"
                  ? "Use local (07…) or +2547… — we’ll normalize."
                  : channel === "email"
                  ? "Must be a valid email."
                  : "Use full international format starting with +."}
              </div>
            </div>

            {/* Template picker */}
            <div>
              <label className="ps-subtitle" style={{ fontSize: ".9rem" }}>
                Quick Template
              </label>
              <select
                className="ps-input"
                value={templateId}
                onChange={(e) => applyTemplate(e.target.value)}
              >
                {TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>

              {/* Tokens helper */}
              <div
                style={{
                  marginTop: 10,
                  border: "1px solid #e6e9f1",
                  borderRadius: 12,
                  background: "#f7f9fc",
                  padding: 10,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800, color: "#334155", marginBottom: 6 }}>
                  Tokens
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {["{name}", "{plan}", "{amount}", "{expiry}", "{paylink}"].map((t) => (
                    <span
                      key={t}
                      style={{
                        padding: "6px 8px",
                        border: "1px solid #e6e9f1",
                        borderRadius: 10,
                        background: "#fff",
                        fontSize: 12,
                        color: "#334155",
                      }}
                      title={`Available: ${t}`}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Message */}
          <div>
            <label className="ps-subtitle" style={{ fontSize: ".9rem" }}>
              Message
            </label>
            <textarea
              className="ps-input"
              rows={6}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your message… tokens like {name} will be replaced before sending (if supported by your backend)."
              required
              style={{ resize: "vertical" }}
            />
            {channel === "sms" && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748b", marginTop: 6 }}>
                <span>
                  Encoding: <b>{smsInfo.isGsm ? "GSM-7" : "UCS-2"}</b> • Segment size: {smsInfo.perSeg}
                </span>
                <span>
                  Segments: <b>{smsInfo.segments}</b>
                </span>
              </div>
            )}
          </div>

          {/* Live Preview */}
          <div
            style={{
              border: "1px solid #eef1f6",
              borderRadius: 12,
              overflow: "hidden",
              background: "#fff",
            }}
          >
            <div
              style={{
                padding: "10px 12px",
                borderBottom: "1px solid #eef1f6",
                fontSize: 12,
                fontWeight: 800,
                color: "#556270",
                letterSpacing: ".04em",
                textTransform: "uppercase",
              }}
            >
              Preview
            </div>
            <div style={{ padding: 12, fontSize: 14, lineHeight: 1.6, color: "#1c2430", minHeight: 64 }}>
              {message || <span style={{ color: "#94a3b8" }}>Your message will appear here…</span>}
            </div>
          </div>

          {/* Actions */}
          <div className="ps-grid">
            <button
              type="button"
              onClick={onClose}
              className="ps-tab"
              style={{ justifyContent: "center" }}
            >
              Cancel
            </button>
            <button type="submit" disabled={!canSend || loading} className="ps-submit">
              {loading ? "Sending…" : `Send ${channel.toUpperCase()}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
