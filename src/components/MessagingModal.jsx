// src/components/MessagingModal.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { FaTimes } from "react-icons/fa";
import { api } from "../lib/apiClient";
import "./MessagingModal.css";
import useDragResize from "../hooks/useDragResize";

const TEMPLATES = [
  {
    id: "due_5",
    label: "Due in 5 days",
    body: "Your plan [Plan Name] ([Price] • [Plan Speed] • [Plan Duration]) will expire on [Expiry Date]. Renew early to stay connected 👉 [Payment Link]",
  },
  {
    id: "due_3",
    label: "Due in 3 days",
    body: "Reminder: [Customer Name], your [Plan Name] plan ([Price], [Plan Speed]) expires on [Expiry Date]. Tap to renew: [Payment Link]",
  },
  {
    id: "due_today",
    label: "Due today (final)",
    body: "Final notice: [Customer Name], your [Plan Name] plan ([Price]) expires today ([Expiry Date]). Renew now: [Payment Link]",
  },
];

function countSmsSegments(text) {
  const gsm7 =
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ" +
    " !\"#¤%&'()*+,-./0123456789:;<=>?" +
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ`" +
    "¿abcdefghijklmnopqrstuvwxyzäöñüà";
  const isGsm = [...(text || "")].every((c) => gsm7.includes(c) || c.charCodeAt(0) < 128);
  const perSeg = isGsm ? 160 : 70;
  const concatPerSeg = isGsm ? 153 : 67;
  if ((text || "").length <= perSeg) return { segments: text ? 1 : 0, perSeg, isGsm };
  return { segments: Math.ceil((text || "").length / concatPerSeg), perSeg: concatPerSeg, isGsm };
}

function replaceTokens(template, vars = {}) {
  const map = {
    name: vars.name,
    customer_name: vars.name,
    plan: vars.plan,
    plan_name: vars.plan,
    planName: vars.plan,
    price: vars.price || vars.amountFormatted || vars.amount,
    amount: vars.amount != null ? String(vars.amount) : undefined,
    amount_formatted: vars.amountFormatted,
    plan_price: vars.price || vars.amountFormatted,
    speed: vars.speed,
    plan_speed: vars.speed,
    duration: vars.duration,
    plan_duration: vars.duration,
    expiry: vars.expiry,
    expiry_date: vars.expiry,
    paylink: vars.paylink,
    payment_link: vars.paylink,
    link: vars.paylink,
  };

  let result = String(template || "");
  for (const [key, value] of Object.entries(map)) {
    if (value == null) continue;
    const variants = buildTokenVariants(key);
    for (const variant of variants) {
      const replacement = String(value);
      const curly = new RegExp(`\\{\\{?\\s*${escapeRegExp(variant)}\\s*\\}?\\}`, "gi");
      const square = new RegExp(`\\[\\s*${escapeRegExp(variant)}\\s*\\]`, "gi");
      result = result.replace(curly, replacement);
      result = result.replace(square, replacement);
    }
  }
  return result;
}

function buildTokenVariants(key) {
  const raw = String(key || "").trim();
  if (!raw) return [""];
  const spaced = raw.replace(/[_-]+/g, " ").trim();
  const lower = spaced.toLowerCase();
  const title = toTitleCase(spaced);
  const compact = spaced.replace(/\s+/g, "");
  const camel = toCamelCase(spaced);
  const pascal = camel ? camel[0].toUpperCase() + camel.slice(1) : "";
  return Array.from(
    new Set(
      [raw, spaced, lower, title, spaced.toUpperCase(), compact, compact.toLowerCase(), compact.toUpperCase(), camel, pascal].filter(Boolean)
    )
  );
}

function toTitleCase(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function toCamelCase(input) {
  return String(input || "")
    .toLowerCase()
    .split(/\s+/)
    .map((word, idx) => (idx === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join("");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function prepareTemplateVariables(seed = {}) {
  const amountRaw = seed.amount != null ? seed.amount : seed.price;
  const amountNumber = typeof amountRaw === "number" ? amountRaw : Number(amountRaw);
  const amountCandidate = Number.isFinite(amountNumber) ? amountNumber : amountRaw;
  const formattedAmount = seed.amountFormatted || seed.priceFormatted || formatPrice(amountCandidate);
  const price = seed.price != null ? formatPrice(seed.price) : formattedAmount;
  const speed = seed.speed != null ? formatSpeed(seed.speed) : formatSpeed(seed.planSpeed);
  const duration = seed.duration || seed.planDuration || seed.durationText;

  return {
    name: seed.name,
    plan: seed.plan,
    amount: amountRaw,
    amountFormatted: formattedAmount,
    price,
    speed,
    duration,
    expiry: seed.expiry,
    paylink: seed.paylink,
  };
}

function formatPrice(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string") {
    if (/[A-Za-z]/.test(value)) return value;
    const numeric = Number(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(numeric)) {
      return formatPrice(numeric);
    }
    return value;
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  try {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  } catch {
    const rounded = Number.isInteger(amount) ? amount : amount.toFixed(2);
    return `KES ${rounded}`;
  }
}

function formatSpeed(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string") {
    if (/mbps/i.test(value)) return value;
    return `${value} Mbps`;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return `${Number.isInteger(num) ? num : Number(num.toFixed(2))} Mbps`;
}

export default function MessagingModal({ isOpen, onClose, defaults }) {
  const seed = defaults || {};
  const templateSeed = prepareTemplateVariables(seed);
  const [channel, setChannel] = useState("sms");
  const [recipient, setRecipient] = useState(seed.recipient || "");
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const [message, setMessage] = useState(
    replaceTokens(TEMPLATES[0].body, templateSeed)
  );
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState("");
  const containerRef = useRef(null);
  const dragHandleRef = useRef(null);
  const { getResizeHandleProps, isDraggingEnabled } = useDragResize({
    isOpen,
    containerRef,
    handleRef: dragHandleRef,
    minWidth: 540,
    minHeight: 520,
    defaultSize: { width: 720, height: 640 },
  });
  const resizeHandles = isDraggingEnabled ? ["n", "s", "e", "w", "ne", "nw", "se", "sw"] : [];

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
    setMessage(replaceTokens(tpl.body, templateSeed));
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
      <div ref={containerRef} className="ps-modal draggable-modal">
        {isDraggingEnabled && (
          <>
            <div className="modal-drag-bar" ref={dragHandleRef}>
              Drag
            </div>
            {resizeHandles.map((dir) => (
              <div
                key={dir}
                className={`modal-resize-handle ${
                  dir.length === 1 ? "edge" : "corner"
                } ${["n", "s"].includes(dir) ? "horizontal" : ""} ${["e", "w"].includes(dir) ? "vertical" : ""} ${dir}`}
                {...getResizeHandleProps(dir)}
              />
            ))}
          </>
        )}
        {/* Close */}
        <button onClick={onClose} className="ps-close" aria-label="Close" data-modal-no-drag>
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
              <label className="ps-subtitle" htmlFor="mm-recipient">
                Recipient
              </label>
              <input
                id="mm-recipient"
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
              <div className="ps-sms-meta">
                <span>
                  {channel === "sms"
                    ? "Use local (07…) or +2547… — we’ll normalize."
                    : channel === "email"
                    ? "Must be a valid email."
                    : "Use full international format starting with +."}
                </span>
              </div>
            </div>

            {/* Template picker */}
            <div>
              <label className="ps-subtitle" htmlFor="mm-template">
                Quick Template
              </label>
              <select
                id="mm-template"
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
              <div className="ps-token-wrap">
                <div className="ps-token-title">Tokens</div>
                <div className="ps-token-list">
                  {["{name}", "{plan}", "{price}", "{speed}", "{duration}", "{expiry}", "{paylink}", "[Plan Name]", "[Payment Link]"].map((t) => (
                    <span key={t} className="ps-token" title={`Available: ${t}`}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Message */}
          <div>
            <label className="ps-subtitle" htmlFor="mm-message">
              Message
            </label>
            <textarea
              id="mm-message"
              className="ps-input"
              rows={6}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your message… tokens like {name} will be replaced before sending (if supported by your backend)."
              required
            />
            {channel === "sms" && (
              <div className="ps-sms-meta">
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
          <div className="ps-preview">
            <div className="ps-preview-head">Preview</div>
            <div className="ps-preview-body">
              {message ? message : <span className="muted">Your message will appear here…</span>}
            </div>
          </div>

          {/* Actions */}
          <div className="ps-grid">
            <button type="button" onClick={onClose} className="ps-tab">
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
