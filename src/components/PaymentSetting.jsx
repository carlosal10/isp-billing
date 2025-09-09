// src/components/PaymentSetting.jsx
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
      className="w-full border rounded-lg px-3 py-2"
      required
    />
  );
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
      "consumerKey",
      "consumerSecret",
      "payMethod",
      "environment",
      "businessName",
      "paybillShortcode",
      "paybillPasskey",
      "buyGoodsTill",
      "buyGoodsPasskey",
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
      // Primary style: /api/payment-config/:provider
      let data;
      try {
        const res = await api.get(`/payment-config/${provider}`);
        data = res.data;
      } catch (e1) {
        // Fallback style: /api/payment-config?provider=mpesa
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
      const payload = { provider, settings: formData[provider] };

      // Primary style: POST /payment-config/:provider
      try {
        await api.post(`/payment-config/${provider}`, payload.settings, {
          headers: { "Content-Type": "application/json" },
        });
      } catch (e1) {
        // Fallback: POST /payment-config with { provider, settings }
        await api.post(`/payment-config`, payload, {
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

  return (
    <div className="modal-overlay fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
      <div className="modal-content bg-white rounded-2xl shadow-lg w-full max-w-2xl p-6 relative">
        <button onClick={onClose} className="absolute top-3 right-3 text-gray-600 hover:text-red-500" aria-label="Close">
          <FaTimes size={20} />
        </button>

        <h2 className="text-2xl font-bold mb-2">Payment Integrations</h2>

        {!effectiveIspId && (
          <p className="text-red-600 text-sm mb-3">
            ISP ID not available. Ensure you’re logged in and a tenant is selected.
          </p>
        )}

        {/* Tabs */}
        <div className="flex space-x-4 border-b mb-4">
          {PROVIDERS.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 pb-2 ${
                activeTab === key
                  ? "border-b-2 border-green-600 text-green-600 font-semibold"
                  : "text-gray-600"
              }`}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        {msg && (
          <p className={`text-sm mb-3 ${msg.startsWith("✓") ? "text-green-600" : "text-red-600"}`}>
            {msg}
          </p>
        )}
        {loading && <p className="text-sm text-gray-500 mb-3">Loading...</p>}

        {/* Provider settings */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-3">
            <h3 className="text-lg font-semibold capitalize">{activeTab} Settings</h3>
            {fields[activeTab].map((field) => {
              if (activeTab === 'mpesa' && field === 'payMethod') {
                return (
                  <select
                    key={field}
                    className="w-full border rounded-lg px-3 py-2"
                    value={formData.mpesa.payMethod || 'paybill'}
                    onChange={(e) => onChange('mpesa', 'payMethod', e.target.value)}
                  >
                    <option value="paybill">Paybill</option>
                    <option value="buygoods">Buy Goods (Till)</option>
                  </select>
                );
              }
              if (activeTab === 'mpesa' && field === 'environment') {
                return (
                  <select
                    key={field}
                    className="w-full border rounded-lg px-3 py-2"
                    value={formData.mpesa.environment || 'sandbox'}
                    onChange={(e) => onChange('mpesa', 'environment', e.target.value)}
                  >
                    <option value="sandbox">Sandbox</option>
                    <option value="production">Production</option>
                  </select>
                );
              }
              const label = field.replace(/([A-Z])/g, " $1");
              const type = /secret|passkey/i.test(field) ? 'password' : 'text';
              return (
                <TextInput
                  key={field}
                  placeholder={label}
                  type={type}
                  value={formData[activeTab][field]}
                  onChange={(val) => onChange(activeTab, field, val)}
                />
              );
            })}
          </div>

          <button
            type="submit"
            className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 transition"
            disabled={loading}
          >
            {loading ? "Saving..." : "Save Settings"}
          </button>
        </form>
      </div>
    </div>
  );
}

