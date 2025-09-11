// src/components/MessagingModal.jsx
import { useEffect, useMemo, useState } from "react";
import { FaTimes } from "react-icons/fa";
import { api } from "../lib/apiClient";

const TEMPLATES = [
  {
    id: "due_5",
    label: "Due in 5 days",
    body:
      "Hi {name}, your {plan} plan (KES {amount}) is due on {expiry}. Pay via {paylink}. Reply STOP to opt out.",
  },
  {
    id: "due_3",
    label: "Due in 3 days",
    body:
      "Reminder: {name}, your {plan} (KES {amount}) expires on {expiry}. Tap to renew: {paylink}",
  },
  {
    id: "due_today",
    label: "Due today (final)",
    body:
      "Final notice: {name}, your {plan} (KES {amount}) expires today {expiry}. Renew now: {paylink}",
  },
];

function countSmsSegments(text) {
  // Basic GSM-7 vs UCS-2 decision, rough but effective for UI feedback
  const gsm7 =
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ" +
    " !\"#¤%&'()*+,-./0123456789:;<=>?" +
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ`" +
    "¿abcdefghijklmnopqrstuvwxyzäöñüà";
  const isGsm =
    [...text].every((c) => gsm7.includes(c) || c.charCodeAt(0) < 128);
  const perSeg = isGsm ? 160 : 70;
  const concatPerSeg = isGsm ? 153 : 67;
  if (text.length <= perSeg) return { segments: text ? 1 : 0, perSeg, isGsm };
  const segments = Math.ceil(text.length / concatPerSeg);
  return { segments, perSeg: concatPerSeg, isGsm };
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
  // defaults can carry prefilled context e.g. {name, plan, amount, expiry, paylink, recipient}
  const seed = defaults || {};
  const [channel, setChannel] = useState("sms");
  const [recipient, setRecipient] = useState(seed.recipient || "");
  const [message, setMessage] = useState(
    replaceTokens(TEMPLATES[0].body, {
      name: seed.name,
      plan: seed.plan,
      amount: seed.amount,
      expiry: seed.expiry,
      paylink: seed.paylink,
    })
  );
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState("");

  // Attach ESC listener only when open; keep hooks unconditionally ordered
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
    e.preventDefault();
    setLoading(true);
    setResp("");
    try {
      if (channel === "sms") {
        await api.post("/sms/send-test", { to: recipient.trim(), body: message.trim() });
        setResp("✅ SMS sent successfully.");
      } else if (channel === "email") {
        // Placeholder wiring; keep same UI flow
        await api.post("/email/send-test", { to: recipient.trim(), subject: "Notification", html: message.trim() });
        setResp("✅ Email sent successfully.");
      } else if (channel === "whatsapp") {
        await api.post("/whatsapp/send-test", { to: recipient.trim(), body: message.trim() });
        setResp("✅ WhatsApp message sent successfully.");
      }
      // Clear only message/recipient for safety; keep channel/template
      setRecipient("");
      setMessage("");
    } catch (err) {
      setResp(
        `❌ Failed to send via ${channel.toUpperCase()}: ${err?.response?.data?.message || err?.message || "error"}`
      );
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] bg-black/50 md:bg-black/60 flex md:items-center md:justify-center"
      onMouseDown={(e) => {
        // click outside to close (desktop); allow inner clicks
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="bg-white w-full h-full md:h-auto md:max-h-[92vh] md:w-[720px] md:rounded-2xl md:shadow-2xl md:border md:border-slate-200 overflow-hidden flex flex-col">
        {/* Sticky header (mobile + desktop) */}
        <div className="relative border-b border-slate-100 px-4 md:px-6 py-3 bg-white">
          <h2 className="text-lg md:text-xl font-extrabold text-[#0B2545] pr-10">Send Message</h2>
          <button
            onClick={onClose}
            className="absolute top-3 right-3 inline-flex items-center justify-center w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-600 hover:shadow-md hover:-translate-y-[1px] transition"
            aria-label="Close"
          >
            <FaTimes size={18} />
          </button>
        </div>

        {/* Body (scrollable) */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-4">
          {/* Channel Tabs */}
          <div className="grid grid-cols-3 gap-2 md:gap-3">
            {["sms", "email", "whatsapp"].map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setChannel(c)}
                className={[
                  "h-11 rounded-xl border text-sm font-extrabold tracking-wide transition",
                  channel === c
                    ? "bg-[#E63946] text-white border-[#E63946] shadow-[0_8px_18px_rgba(230,57,70,.25)]"
                    : "bg-white text-[#0B2545] border-slate-200 hover:shadow-md",
                ].join(" ")}
              >
                {c.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Recipient */}
          <div className="space-y-1">
            <label htmlFor="recipient" className="block text-sm font-semibold text-slate-700">
              Recipient
            </label>
            <input
              id="recipient"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={
                channel === "sms"
                  ? "e.g. 07XXXXXXXX or +2547XXXXXXX"
                  : channel === "email"
                  ? "user@example.com"
                  : "WhatsApp number e.g. +2547XXXXXXX"
              }
              required
              className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-white text-slate-900 outline-none focus:ring-4 focus:ring-[#E63946]/20 focus:border-[#E63946] transition"
            />
            <p className="text-xs text-slate-500">
              {channel === "sms"
                ? "Use local (07…) or E.164 format (+2547…)."
                : channel === "email"
                ? "Must be a valid email address."
                : "Use full international format starting with +."}
            </p>
          </div>

          {/* Template + variables */}
          <div className="grid md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-sm font-semibold text-slate-700">Quick Template</label>
              <select
                value={templateId}
                onChange={(e) => applyTemplate(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-white text-slate-900 outline-none focus:ring-4 focus:ring-[#E63946]/20 focus:border-[#E63946] transition"
              >
                {TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Token helper (read-only preview of available tokens) */}
            <div className="rounded-xl border border-slate-200 p-3 bg-slate-50/60">
              <div className="text-xs font-bold text-slate-700 mb-1">Tokens</div>
              <div className="flex flex-wrap gap-2 text-xs">
                {["{name}", "{plan}", "{amount}", "{expiry}", "{paylink}"].map((t) => (
                  <span
                    key={t}
                    className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-700"
                    title={`Available: ${t}`}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Message */}
          <div className="space-y-1">
            <label htmlFor="message" className="block text-sm font-semibold text-slate-700">
              Message
            </label>
            <textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your message… tokens like {name} will be replaced before sending (if used by your backend)."
              rows={6}
              required
              className="w-full rounded-xl border border-slate-200 bg-white text-slate-900 p-3 outline-none focus:ring-4 focus:ring-[#E63946]/20 focus:border-[#E63946] transition"
            />
            {/* Counters (SMS only) */}
            {channel === "sms" && (
              <div className="text-xs text-slate-600 flex items-center justify-between">
                <span>
                  Encoding: {smsInfo.isGsm ? "GSM-7" : "UCS-2"} • Segment size: {smsInfo.perSeg} chars
                </span>
                <span className="font-bold">
                  Segments: {smsInfo.segments}
                </span>
              </div>
            )}
          </div>

          {/* Live Preview */}
          <div className="rounded-2xl border border-slate-200 bg-white">
            <div className="px-3 py-2 border-b border-slate-100 text-xs font-bold text-slate-600 uppercase tracking-wide">
              Preview
            </div>
            <div className="p-3 text-sm leading-6 text-slate-800">
              {message || <span className="text-slate-400">Your message will appear here…</span>}
            </div>
          </div>

          {/* Response */}
          {!!resp && (
            <div
              className={[
                "rounded-xl px-3 py-2 text-sm",
                resp.startsWith("✅") ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-rose-50 text-rose-700 border border-rose-200",
              ].join(" ")}
            >
              {resp}
            </div>
          )}
        </form>

        {/* Footer actions (sticky) */}
        <div className="border-t border-slate-100 p-3 md:p-4 bg-white">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onClose}
              className="h-11 rounded-xl border border-slate-200 bg-white text-[#0B2545] font-extrabold hover:shadow-md transition"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSend}
              className="h-11 rounded-xl bg-[#E63946] text-white font-extrabold shadow-[0_6px_16px_rgba(230,57,70,.25)] hover:brightness-105 disabled:opacity-60 disabled:cursor-not-allowed transition"
            >
              {loading ? "Sending…" : `Send ${channel.toUpperCase()}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
