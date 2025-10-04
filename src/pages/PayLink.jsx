import React, { useEffect, useMemo, useState, useCallback } from "react";
import { api } from "../lib/apiClient";
import "./PayLink.css";

function useQuery() {
  return useMemo(() => new URLSearchParams(window.location.search), []);
}

function formatKES(amount) {
  if (amount == null) return "";
  try {
    // Intl for spacing/grouping; keep "KES" prefix for clarity
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
  let v = String(input).replace(/\D/g, ""); // keep digits
  if (v.startsWith("0")) v = v.slice(1);    // 07.. -> 7..
  if (v.startsWith("254")) v = v.slice(3);  // 2547.. -> 7..
  if (v.startsWith("7") && v.length === 9) return `254${v}`;
  return ""; // invalid
}

export default function PayLink() {
  const q = useQuery();
  const token = q.get("token");

  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [paymentId, setPaymentId] = useState("");
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
      if (pid) setPaymentId(pid);
      setMessage("Payment request sent. Check your phone to approve.");
      // Begin short polling for confirmation
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
    // Timeout
    setMessage((m) => m || "Still processing. You will be notified once confirmed.");
  }, []);

  function handleKey(e) {
    if (e.key === "Enter" && canPay) {
      e.preventDefault();
      pay();
    }
  }

  return (
    <div className="pay-wrap">
      <nav className="pay-nav" aria-label="Brand and security">
        <div className="pay-brand">KT-SwiftBridge</div>
        <div className="pay-secure">🔒 Secure Checkout</div>
      </nav>

      <main className="pay-main" role="main">
        <section className="pitch" aria-labelledby="pitch-title">
          <h1 id="pitch-title">Fast, secure payments for your internet plan.</h1>
          <p>
            Settle your subscription in seconds with STK-Push. Simple, safe, and powered by
            KT-SwiftBridge.
          </p>
          <div className="trust">
            <span className="dot" /> Trusted by growing ISPs
          </div>
        </section>

        <section className="pay-card" aria-labelledby="pay-title">
          <div className="card-ambient" aria-hidden="true" />
          <h2 id="pay-title">Subscription Payment</h2>
          <div className="sub">Pay for your selected plan</div>

          {loading && (
            <div className="skeleton-wrap" aria-busy="true" aria-live="polite">
              <div className="sk-line w-40" />
              <div className="sk-box" />
              <div className="sk-line w-60" />
              <div className="sk-line w-80" />
            </div>
          )}

          {!loading && error && (
            <div className="msg-err" role="alert">
              {error}
              <button className="pay-btn alt" onClick={fetchInfo} type="button">
                Retry
              </button>
            </div>
          )}

          {!loading && !error && info && (
            <>
              <div className="pay-field">
                <div className="sub">Customer</div>
                <div className="customer-name">{info.customer?.name || "Customer"}</div>
              </div>

              <div className="plan-box" role="group" aria-label="Current plan">
                <div className="plan-top">
                  <div>
                    <div className="plan-name">{plan?.name}</div>
                    <div className="plan-desc">{plan?.description}</div>
                  </div>
                  <div className="plan-price">{formatKES(plan?.price)}</div>
                </div>
                <div className="plan-meta">
                  Expiry:&nbsp;<strong>{formatDate(info.dueAt)}</strong>
                </div>
              </div>

              <div className="pay-field">
                <label htmlFor="phone">Pay from phone number</label>
                <input
                  id="phone"
                  className={`pay-input ${phone && !msisdn ? "invalid" : ""}`}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={handleKey}
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="07XXXXXXXX or +2547XXXXXXXX"
                  aria-describedby="phone-help"
                />
                <small id="phone-help" className="hint">
                  We’ll send an M-Pesa STK prompt to this number. Kenyan numbers only.
                </small>
                {phone && !msisdn && (
                  <div className="msg-err inline" role="alert">
                    Enter a valid Safaricom mobile (e.g., 07XXXXXXXX).
                  </div>
                )}
              </div>

              <button
                className="pay-btn"
                onClick={pay}
                disabled={!canPay}
                type="button"
                aria-live="polite"
              >
                {sending ? "Sending…" : `Pay ${formatKES(plan?.price)} via M-Pesa`}
              </button>

              {(message || error) && (
                <p className={message ? "msg-ok" : "msg-err"} role="status" aria-live="polite">
                  {message || error}
                </p>
              )}
              {status && !error && (
                <div className="sub" aria-live="polite">Status: {status}</div>
              )}

              {!!otherPlans.length && (
                <div className="other" aria-labelledby="other-plans-title">
                  <h3 id="other-plans-title">Other Plans</h3>
                  <div className="other-grid">
                    {otherPlans.map((p) => (
                      <div key={p._id} className="other-item" tabIndex={0}>
                        <div className="nm">{p.name}</div>
                        <div className="ds">{p.description}</div>
                        <div className="pr">{formatKES(p.price)}</div>
                      </div>
                    ))}
                  </div>
                  <p className="other-note">
                    Want to upgrade or switch? Contact support to change plans before paying.
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      <footer className="pay-footer">
        Payments are processed securely. Need help? Contact your ISP.
      </footer>
    </div>
  );
}
