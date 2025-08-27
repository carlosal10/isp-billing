import { useState, useEffect } from "react";
import { FaTimes, FaStripe, FaPaypal, FaMoneyBillWave } from "react-icons/fa";
import "./PaymentSetting.css";

const API_BASE = "https://isp-billing-uq58.onrender.com/api/payments-config";

// ✅ Reusable Input Component
function TextInput({ value, onChange, placeholder }) {
  return (
    <input
      type="text"
      placeholder={placeholder}
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border rounded-lg px-3 py-2"
      required
    />
  );
}

export default function PaymentIntegrationsModal({ isOpen, onClose, ispId }) {
  const [activeTab, setActiveTab] = useState("mpesa");
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    mpesa: {
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
      "businessName",
      "paybillShortcode",
      "paybillPasskey",
      "buyGoodsTill",
      "buyGoodsPasskey",
    ],
    stripe: ["publishableKey", "secretKey"],
    paypal: ["clientId", "clientSecret"],
  };

  // ✅ Fetch settings if ISP ID exists
  useEffect(() => {
    if (!isOpen) return;

    if (!ispId) {
      console.warn("No ISP ID provided, skipping fetch.");
      return;
    }

    const fetchSettings = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/${ispId}/${activeTab}`);
        if (!res.ok) throw new Error("Failed to fetch settings");

        const data = await res.json();
        if (data) {
          setFormData((prev) => ({
            ...prev,
            [activeTab]: { ...prev[activeTab], ...data },
          }));
        }
      } catch (err) {
        console.error("Error loading settings:", err);
        alert("Failed to load settings. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, [isOpen, activeTab, ispId]);

  const handleChange = (provider, field, value) => {
    setFormData((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], [field]: value },
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!ispId) {
      alert("ISP ID missing. Cannot save settings until multi-user setup is complete.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ispId,
          provider: activeTab,
          settings: formData[activeTab],
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save settings");

      alert(data.message || "Settings saved successfully");
      onClose();
    } catch (err) {
      console.error("Error saving settings:", err);
      alert(err.message || "Server error while saving settings");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
      <div className="modal-content bg-white rounded-2xl shadow-lg w-full max-w-2xl p-6 relative">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-600 hover:text-red-500"
        >
          <FaTimes size={20} />
        </button>

        <h2 className="text-2xl font-bold mb-2">Payment Integrations</h2>

        {/* ⚠ Show warning if ISP ID is missing */}
        {!ispId && (
          <p className="text-red-600 text-sm mb-3">
            ⚠ ISP ID not available. Payment settings cannot be loaded until multi-user setup is complete.
          </p>
        )}

        {/* Tabs */}
        <div className="flex space-x-4 border-b mb-4">
          {[
            { key: "mpesa", label: "M-Pesa", icon: <FaMoneyBillWave /> },
            { key: "stripe", label: "Stripe", icon: <FaStripe /> },
            { key: "paypal", label: "PayPal", icon: <FaPaypal /> },
          ].map(({ key, label, icon }) => (
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

        {loading && <p className="text-sm text-gray-500 mb-3">Loading...</p>}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-3">
            <h3 className="text-lg font-semibold capitalize">{activeTab} Settings</h3>
            {fields[activeTab].map((field) => (
              <TextInput
                key={field}
                placeholder={field.replace(/([A-Z])/g, " $1")}
                value={formData[activeTab][field]}
                onChange={(val) => handleChange(activeTab, field, val)}
              />
            ))}
          </div>

          <button
            type="submit"
            className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 transition"
            disabled={loading || !ispId}
          >
            {loading ? "Saving..." : "Save Settings"}
          </button>
        </form>
      </div>
    </div>
  );
}
