import React, { useEffect, useMemo, useState, useCallback } from "react";
import { api } from "../lib/apiClient";

/** -------------------- utils -------------------- */
function useQuery() {
  return useMemo(() => new URLSearchParams(window.location.search), []);
}

function formatKES(amount) {
  if (amount == null) return "";
  try {
    return `KES ${new Intl.NumberFormat("en-KE").format(Number(amount))}`;
  } catch {
    return `KES ${amount}`;
  }
}

function formatDate(d) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return new Date(d).toLocaleDateString();
  }
}

// Normalize Kenyan mobile to 2547XXXXXXXX (M-Pesa friendly)
function normalizeMsisdn(input) {
  if (!input) return "";
  let v = String(input).replace(/\D/g, "");
  if (v.startsWith("0")) v = v.slice(1);
  if (v.startsWith("254")) v = v.slice(3);
  if (v.startsWith("7") && v.length === 9) return `254${v}`;
  return "";
}

/** -------------------- redesigned component -------------------- */
export default function PayLink() {
  const q = useQuery();
  const token = q.get("token");

  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");

  const plan = info?.plan || null;
  const otherPlans = (info?.otherPlans || []).filter((p) => p._id !== plan?._id);

  const fetchInfo = useCallback(async () => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const res = await api.get("/paylink/info", { params: { token } });
      setInfo(res.data);
      // prefill phone if server shares a recent MSISDN
      if (res?.data?.customer?.phone) {
        const suggested = String(res.data.customer.phone);
        setPhone((prev) => prev || suggested);
      }
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      setError("Missing token");
      setLoading(false);
      return;
    }
    fetchInfo();
  }, [token, fetchInfo]);

  const msisdn = normalizeMsisdn(phone);
  const canPay = Boolean(plan?.price) && Boolean(msisdn) && !sending;

  async function pay() {
    if (!token || !msisdn) return;
    setSending(true);
    setMessage("");
    setError("");
    try {
      const resp = await api.post("/paylink/stk", { token, phone: msisdn });
      const pid = resp?.data?.paymentId;
      setMessage("Payment request sent. Check your phone to approve.");
      if (pid) pollStatus(pid);
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || "Failed to initiate payment");
    } finally {
      setSending(false);
    }
  }

  // Poll status until terminal state or timeout
  const pollStatus = useCallback(async (pid) => {
    const started = Date.now();
    const timeoutMs = 2 * 60 * 1000; // 2 minutes
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    while (Date.now() - started < timeoutMs) {
      try {
        const res = await api.get("/paylink/status", { params: { paymentId: pid } });
        const st = res?.data?.status;
        setStatus(st || "");
        if (st === "Success" || st === "Validated") {
          setMessage("Payment successful. Thank you!");
          return;
        }
        if (st === "Failed" || st === "Reversed") {
          setError("Payment failed. If charged, contact support with M-Pesa code.");
          return;
        }
      } catch {}
      await delay(3000);
    }
    setMessage((m) => m || "Still processing. You will be notified once confirmed.");
  }, []);

  function handleKey(e) {
    if (e.key === "Enter" && canPay) {
      e.preventDefault();
      pay();
    }
  }

  return (
    <div className="pl2-wrap">
      {/* Top Bar */}
      <header className="pl2-nav" aria-label="Brand and security">
        <div className="brand">
          <span className="logo-dot" aria-hidden="true" />
          <strong>KT‑SwiftBridge</strong>
        </div>
        <div className="secure">
          <span className="lock" aria-hidden>🔒</span> Secure Checkout
        </div>
      </header>

      {/* Hero */}
      <section className="pl2-hero" aria-labelledby="hero-title">
        <div className="hero-content">
          <h1 id="hero-title">Pay your internet in seconds—then get back to what matters.</h1>
          <p className="hero-sub">Fast STK Push • Bank‑grade security • Instant confirmation</p>
          <ol className="steps" aria-label="How it works">
            <li className="step done"><span className="badge">1</span> Enter phone</li>
            <li className={`step ${sending ? "active" : ""}`}><span className="badge">2</span> Approve STK</li>
            <li className={`step ${status ? "active" : ""}`}><span className="badge">3</span> Connected</li>
          </ol>
        </div>
        <div className="hero-float" aria-hidden="true" />
      </section>

      {/* Main Grid */}
      <main className="pl2-main" role="main">
        <section className="panel pay" aria-labelledby="pay-title">
          <h2 id="pay-title">Complete your payment</h2>
          <p className="muted">M‑Pesa STK will pop up on your phone. No fees added.</p>

          {loading && (
            <div className="skeleton" aria-busy>
              <div className="sk sk-line w-60" />
              <div className="sk sk-line w-80" />
              <div className="sk sk-box" />
            </div>
          )}

          {!loading && error && (
            <div className="alert error" role="alert">
              <div className="alert-title">We couldn’t load your link</div>
              <div className="alert-text">{error}</div>
              <button className="btn ghost" onClick={fetchInfo} type="button">Retry</button>
            </div>
          )}

          {!loading && !error && info && (
            <>
              {/* phone */}
              <label htmlFor="phone" className="label">Pay from phone number</label>
              <div className="phone-row">
                <div className="prefix">+254</div>
                <input
                  id="phone"
                  className={`input ${phone && !msisdn ? "invalid" : ""}`}
                  value={phone.startsWith("+254") ? phone.replace("+254", "") : phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={handleKey}
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="7XXXXXXXX"
                />
              </div>
              <small className="hint">Safaricom numbers only. You’ll receive an STK prompt to approve.</small>
              {phone && !msisdn && (
                <div className="inline-error" role="alert">Enter a valid number like <strong>07XXXXXXXX</strong>.</div>
              )}

              {/* pay button */}
              <button className="btn primary" onClick={pay} disabled={!canPay} type="button" aria-live="polite">
                {sending ? "Sending…" : `Pay ${formatKES(plan?.price)} via M‑Pesa`}
              </button>

              {(message || error) && (
                <div className={`alert ${message ? "ok" : "error"}`} role="status" aria-live="polite">
                  {message || error}
                </div>
              )}
              {status && !error && (
                <div className="status-pill" aria-live="polite">Status: {status}</div>
              )}

              {/* trust */}
              <div className="trust">
                <span className="dot" /> Trusted by growing ISPs • Secured with TLS 1.2+
              </div>
            </>
          )}
        </section>

        <aside className="panel summary" aria-labelledby="sum-title">
          <h3 id="sum-title">Your plan</h3>

          {loading && (
            <div className="sk sk-box" />
          )}

          {!loading && !error && info && (
            <>
              <div className="plan">
                <div className="plan-h">
                  <div>
                    <div className="plan-name">{plan?.name}</div>
                    <div className="plan-desc">{plan?.description}</div>
                  </div>
                  <div className="plan-price">{formatKES(plan?.price)}</div>
                </div>
                <div className="plan-meta">Expiry: <strong>{formatDate(info.dueAt)}</strong></div>
                <div className="customer">Customer: <strong>{info.customer?.name || "Customer"}</strong></div>
              </div>

              {!!otherPlans.length && (
                <div className="other">
                  <div className="other-h">Other plans</div>
                  <div className="other-grid">
                    {otherPlans.map((p) => (
                      <div key={p._id} className="other-item" tabIndex={0}>
                        <div className="nm">{p.name}</div>
                        <div className="ds">{p.description}</div>
                        <div className="pr">{formatKES(p.price)}</div>
                      </div>
                    ))}
                  </div>
                  <p className="other-note">Want to switch or upgrade? Contact support before paying.</p>
                </div>
              )}
            </>
          )}
        </aside>
      </main>

      <footer className="pl2-footer">Payments are processed securely. Need help? Contact your ISP.</footer>

      {/* -------------------- styles (self-contained) -------------------- */}
      <style>{`
      :root{
        --ink:#0a1729; --muted:#63708b; --bg:#f6f9ff; --card:#ffffff;
        --primary:#0B66FF; --primary-2:#7AA2FF; --accent:#F1C40F; --danger:#E11D48; --ok:#127a33;
        --ring:0 0 0 3px rgba(11,102,255,.15);
        --shadow-sm:0 6px 16px rgba(0,0,0,.06);
        --shadow-md:0 12px 32px rgba(0,0,0,.12);
      }
      *{box-sizing:border-box}
      .pl2-wrap{min-height:100svh; display:grid; grid-template-rows:auto auto 1fr auto; background:var(--bg); color:var(--ink); font-family:"Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif}

      /* Top bar */
      .pl2-nav{position:sticky;top:0;z-index:10; display:flex;justify-content:space-between;align-items:center; padding:14px 2.5%; background:var(--card); border-bottom:1px solid #e9eef7}
      .brand{display:flex;align-items:center;gap:10px;font-weight:800}
      .logo-dot{width:10px;height:10px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--primary-2)); box-shadow:0 0 0 6px rgba(11,102,255,.08)}
      .secure{font-weight:700;color:#2d3b53}

      /* Hero */
      .pl2-hero{position:relative; padding:26px 2.5%;}
      .hero-content{max-width:1100px;margin:0 auto; background:linear-gradient(180deg,#ffffff,#f9fbff); border:1px solid #e9eef7;border-radius:16px; padding:18px; box-shadow:var(--shadow-sm); position:relative; overflow:hidden}
      .hero-float{position:absolute; inset:0; background: radial-gradient(420px 120px at 110% 110%, rgba(241,196,15,.12), transparent 60%), radial-gradient(520px 160px at -10% -10%, rgba(11,102,255,.12), transparent 60%); pointer-events:none}
      .pl2-hero h1{margin:0 0 6px; font-size:clamp(1.4rem,4vw,1.9rem); font-weight:900; color:#0b2545}
      .hero-sub{margin:0 0 10px; color:#2b3749; font-weight:600}
      .steps{list-style:none; display:flex; gap:12px; padding:0; margin:6px 0 0}
      .step{display:flex;align-items:center;gap:8px; color:#415674; font-weight:700}
      .step .badge{display:inline-grid;place-items:center; width:22px;height:22px;border-radius:999px; background:#eef2ff; border:1px solid #dfe6fb; font-size:.85rem}
      .step.active .badge{background:#e8f0ff; border-color:#cfe0ff}
      .step.done .badge{background:#d1fae5; border-color:#a7f3d0}

      /* Main grid */
      .pl2-main{max-width:1100px; width:100%; margin:0 auto; padding:8px 2.5% 36px; display:grid; gap:16px; grid-template-columns:1fr 1fr}
      .panel{background:var(--card); border:1px solid #e9eef7; border-radius:18px; padding:18px; box-shadow:var(--shadow-sm); position:relative; overflow:hidden}
      .panel h2, .panel h3{margin:0 0 6px; font-weight:900; color:#0b2545}
      .muted{color:var(--muted)}

      /* Pay panel */
      .label{display:block; font-weight:800; margin:10px 0 8px}
      .phone-row{display:flex; align-items:stretch; gap:0}
      .prefix{display:grid;place-items:center; padding:0 10px; background:#f0f4ff; border:1px solid #dfe6fb; border-right:none; border-radius:12px 0 0 12px; color:#254071; font-weight:800}
      .input{flex:1; padding:12px 12px; border:1px solid #dfe6fb; border-radius:0 12px 12px 0; outline:none; font:inherit; background:#fff; transition:border .15s, box-shadow .15s}
      .input:focus{box-shadow:var(--ring); border-color:#b7caff}
      .input.invalid{border-color:#ef4444; box-shadow:0 0 0 3px rgba(239,68,68,.15)}
      .hint{color:#63708b; display:block; margin:6px 0 0}
      .inline-error{margin-top:6px; color:#b91c1c; font-weight:700}

      .btn{display:inline-flex; align-items:center; justify-content:center; gap:10px; padding:12px 16px; border-radius:12px; border:1px solid #cfe0ff; background:#fff; font-weight:900; cursor:pointer; transition:.2s ease transform, .2s ease filter, .2s ease background}
      .btn:hover{transform:translateY(-1px)}
      .btn:disabled{opacity:.65; cursor:not-allowed; transform:none}
      .btn.primary{background:linear-gradient(135deg, var(--primary), #0b43b5); color:#fff; border:none; box-shadow:var(--shadow-md)}
      .btn.ghost{background:#fff}

      .alert{margin-top:10px; padding:10px 12px; border-radius:12px; border:1px solid #e5e7eb; font-weight:700}
      .alert.ok{border-color:#bbf7d0; background:#ecfdf5; color:var(--ok)}
      .alert.error{border-color:#fecdd3; background:#fff1f2; color:#b91c1c}
      .alert-title{font-weight:900}
      .alert-text{font-weight:600}
      .status-pill{display:inline-block; margin-top:8px; padding:6px 10px; border-radius:999px; background:#eef2ff; border:1px solid #dfe6fb; color:#254071; font-weight:800}

      .trust{margin-top:14px; color:#3a4a62; font-weight:700; display:flex; align-items:center; gap:8px}
      .dot{width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block}

      /* Summary panel */
      .plan{border:1px solid #e9eef7; border-radius:14px; padding:14px; background:linear-gradient(180deg,#ffffff,#fbfcff)}
      .plan-h{display:flex; align-items:flex-start; justify-content:space-between; gap:12px}
      .plan-name{font-weight:900; color:#0b2545}
      .plan-desc{color:#2b3749}
      .plan-price{font-weight:900; color:#0b2545; white-space:nowrap}
      .plan-meta{margin-top:6px; color:#445675}
      .customer{margin-top:6px; color:#2b3749}

      .other{margin-top:16px}
      .other-h{font-weight:900; color:#0b2545}
      .other-grid{display:grid; grid-template-columns: repeat(auto-fit,minmax(220px,1fr)); gap:12px; margin-top:10px}
      .other-item{background:#fff; border:1px solid #eef1f6; border-radius:12px; padding:12px; box-shadow:0 6px 16px rgba(0,0,0,.05); transition:.2s ease transform, .2s ease box-shadow}
      .other-item:hover{transform:translateY(-3px); box-shadow:0 14px 36px rgba(0,0,0,.12)}
      .nm{font-weight:900; color:#0b2545}
      .ds{color:#2b3749; margin:4px 0}
      .pr{font-weight:900; color:#0b2545}
      .other-note{color:#5a6a84; margin-top:8px}

      /* Skeletons */
      .skeleton{display:grid; gap:10px}
      .sk{position:relative; overflow:hidden; border-radius:10px; background:#eef2f7}
      .sk-line{height:14px}
      .sk-line.w-60{width:60%}
      .sk-line.w-80{width:80%}
      .sk-box{height:84px}
      .sk::after{content:""; position:absolute; inset:0; background:linear-gradient(90deg, transparent, rgba(255,255,255,.6), transparent); transform:translateX(-100%); animation:shimmer 1.2s infinite}
      @keyframes shimmer{to{transform:translateX(100%)}}

      /* Footer */
      .pl2-footer{text-align:center; color:#556274; padding:18px 2.5%; border-top:1px solid #e9eef7}

      /* Responsive */
      @media (max-width: 900px){ .pl2-main{grid-template-columns:1fr} }
      @media (max-width: 640px){ .pl2-hero{padding:18px 4%} .pl2-main{padding:8px 4% 36px} }
      `}</style>
    </div>
  );
}

