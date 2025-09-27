import { useEffect, useState } from "react"; 
import { FaTimes, FaStripe, FaPaypal, FaMoneyBillWave } from "react-icons/fa";
import "./PaymentSetting.css";
import { api } from "../lib/apiClient";
import { useAuth } from "../context/AuthContext";

const PROVIDERS = [
  { key: "mpesa", label: "M-Pesa", icon: <FaMoneyBillWave /> },
  { key: "stripe", label: "Stripe", icon: <FaStripe /> },
  { key: "paypal", label: "PayPal", icon: <FaPaypal /> },
];

function TextInput({ value, onChange, placeholder, type = "text" }) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      className="ps-input"
      required
    />
  );
}

/** ====== helpers ====== */
const M_PESA_COMMON_FIELDS = [
  "consumerKey",
  "consumerSecret",
  "payMethod",     // "paybill" | "buygoods"
  "environment",   // "sandbox" | "production"
  "businessName",
];

const M_PESA_PAYBILL_FIELDS = ["paybillShortcode", "paybillPasskey"];
const M_PESA_BUYGOODS_FIELDS = ["buyGoodsTill", "buyGoodsPasskey"];

function labelize(field) {
  return field.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

export default function PaymentIntegrationsModal({ isOpen, onClose, ispId }) {
  const { ispId: ctxIspId } = useAuth();
  const effectiveIspId = ispId || ctxIspId || null;

  const [activeTab, setActiveTab] = useState("mpesa");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const [formData, setFormData] = useState({
    mpesa: {
      consumerKey: "",
      consumerSecret: "",
      payMethod: "paybill",
      environment: "sandbox",
      businessName: "",
      paybillShortcode: "",
      paybillPasskey: "",
      buyGoodsTill: "",
      buyGoodsPasskey: "",
    },
    stripe: {
      publishableKey: "",
      secretKey: "",
    },
    paypal: {
      clientId: "",
      clientSecret: "",
    },
  });

  const fields = {
    mpesa: [
      ...M_PESA_COMMON_FIELDS,
      ...M_PESA_PAYBILL_FIELDS,
      ...M_PESA_BUYGOODS_FIELDS,
    ],
    stripe: ["publishableKey", "secretKey"],
    paypal: ["clientId", "clientSecret"],
  };

  useEffect(() => {
    if (!isOpen) return;
    setMsg("");
    loadProvider(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab]);

  function onChange(provider, field, value) {
    setFormData((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], [field]: value },
    }));
  }

  async function loadProvider(provider) {
    setLoading(true);
    setMsg("");
    try {
      let data;
      try {
        const res = await api.get(`/payment-config/${provider}`);
        data = res.data;
      } catch (e1) {
        const res2 = await api.get(`/payment-config`, { params: { provider } });
        data = res2.data;
      }
      if (data && typeof data === "object") {
        setFormData((prev) => ({
          ...prev,
          [provider]: { ...prev[provider], ...data },
        }));
      }
    } catch (e) {
      console.error("Load payment config failed:", e?.__debug || e);
      setMsg(`Failed to load ${provider} settings${e?.message ? `: ${e.message}` : ""}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setMsg("");
    try {
      const provider = activeTab;

      let settings = formData[provider];

      // ——— Only send ACTIVE fields ———
      if (provider === "mpesa") {
        const mode = settings.payMethod === "buygoods" ? "buygoods" : "paybill";
        const activeList = [
          ...M_PESA_COMMON_FIELDS,
          ...(mode === "paybill" ? M_PESA_PAYBILL_FIELDS : M_PESA_BUYGOODS_FIELDS),
        ];
        settings = pick(settings, activeList); // prune inactive fields out of payload
      }

      try {
        await api.post(`/payment-config/${provider}`, settings, {
          headers: { "Content-Type": "application/json" },
        });
      } catch (e1) {
        await api.post(`/payment-config`, { provider, settings }, {
          headers: { "Content-Type": "application/json" },
        });
      }

      setMsg("✓ Settings saved");
      onClose && onClose();
    } catch (e) {
      console.error("Save payment config failed:", e?.__debug || e);
      setMsg(`Failed to save settings${e?.message ? `: ${e.message}` : ""}`);
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  // Compute visible fields for MPesa based on selected pay method
  const mpesaMode = formData.mpesa.payMethod === "buygoods" ? "buygoods" : "paybill";
  const mpesaVisibleFields = [
    ...M_PESA_COMMON_FIELDS,
    ...(mpesaMode === "paybill" ? M_PESA_PAYBILL_FIELDS : M_PESA_BUYGOODS_FIELDS),
  ];

  return (
    <div className="ps-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="ps-modal">
        <button onClick={onClose} className="ps-close" aria-label="Close">
          <FaTimes size={18} />
        </button>

        <header className="ps-head">
          <div className="ps-chip">Payments</div>
          <h2>Payment Integrations</h2>
          {!effectiveIspId && (
            <p className="ps-warn">ISP ID not available. Ensure you’re logged in and a tenant is selected.</p>
          )}
        </header>

        {/* Tabs */}
        <div className="ps-tabs">
          {PROVIDERS.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`ps-tab ${activeTab === key ? "active" : ""}`}
            >
              <span className="ps-tab-ico">{icon}</span>
              {label}
            </button>
          ))}
        </div>

        {msg && <p className={`ps-msg ${msg.startsWith("✓") ? "ok" : "err"}`}>{msg}</p>}
        {loading && <p className="ps-loading">Loading…</p>}

        {/* Provider settings */}
        <form onSubmit={handleSubmit} className="ps-form">
          <h3 className="ps-subtitle">{activeTab} Settings</h3>

          <div className="ps-grid">
            {activeTab === "mpesa" ? (
              <>
                {/* payMethod */}
                <select
                  className="ps-input"
                  value={formData.mpesa.payMethod || "paybill"}
                  onChange={(e) => onChange("mpesa", "payMethod", e.target.value)}
                >
                  <option value="paybill">Paybill</option>
                  <option value="buygoods">Buy Goods (Till)</option>
                </select>

                {/* environment */}
                <select
                  className="ps-input"
                  value={formData.mpesa.environment || "sandbox"}
                  onChange={(e) => onChange("mpesa", "environment", e.target.value)}
                >
                  <option value="sandbox">Sandbox</option>
                  <option value="production">Production</option>
                </select>

                {/* The rest of the MPesa fields, filtered by payMethod */}
                {mpesaVisibleFields
                  .filter((f) => !["payMethod", "environment"].includes(f)) // already rendered above
                  .map((field) => {
                    const type = /secret|passkey/i.test(field) ? "password" : "text";
                    return (
                      <TextInput
                        key={field}
                        placeholder={labelize(field)}
                        type={type}
                        value={formData.mpesa[field]}
                        onChange={(val) => onChange("mpesa", field, val)}
                      />
                    );
                  })}
              </>
            ) : (
              fields[activeTab].map((field) => {
                const type = /secret/i.test(field) ? "password" : "text";
                return (
                  <TextInput
                    key={field}
                    placeholder={labelize(field)}
                    type={type}
                    value={formData[activeTab][field]}
                    onChange={(val) => onChange(activeTab, field, val)}
                  />
                );
              })
            )}
          </div>

          <button type="submit" className="ps-submit" disabled={loading}>
            {loading ? "Saving..." : "Save Settings"}
          </button>
        </form>
      </div>
    </div>
  );
}
