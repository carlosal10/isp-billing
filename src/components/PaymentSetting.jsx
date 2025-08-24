import { useState, useEffect } from "react";
import { FaTimes, FaStripe, FaPaypal, FaMoneyBillWave } from "react-icons/fa";
import './PaymentSetting.css'; // ✅ custom styles

const API_BASE = "https://isp-billing-uq58.onrender.com/api/payments"; // backend path

export default function PaymentIntegrationsModal({ isOpen, onClose, ispId }) {
  const [activeTab, setActiveTab] = useState("mpesa");
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    mpesa: { businessName: "", paybillShortcode: "", paybillPasskey: "", buyGoodsTill: "", buyGoodsPasskey: "" },
    stripe: { publishableKey: "", secretKey: "" },
    paypal: { clientId: "", clientSecret: "" },
  });

  // Load existing settings on modal open or tab change
  useEffect(() => {
    if (!isOpen) return;

    const fetchSettings = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/${ispId}/${activeTab}`);
        const data = await res.json();
        if (data) setFormData((prev) => ({ ...prev, [activeTab]: data }));
      } catch (err) {
        console.error("Error loading settings:", err);
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
      if (res.ok) {
        alert(data.message || "Settings saved successfully");
        onClose();
      } else {
        alert(data.error || "Failed to save settings");
      }
    } catch (err) {
      console.error("Error saving settings:", err);
      alert("Server error while saving settings");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
      <div className="modal-content bg-white rounded-2xl shadow-lg w-full max-w-2xl p-6 relative">
        {/* Close Button */}
        <button onClick={onClose} className="absolute top-3 right-3 text-gray-600 hover:text-red-500">
          <FaTimes size={20} />
        </button>

        <h2 className="text-2xl font-bold mb-4">Payment Integrations</h2>

        {/* Tabs */}
        <div className="flex space-x-4 border-b mb-4">
          <button
            onClick={() => setActiveTab("mpesa")}
            className={`flex items-center gap-2 pb-2 ${activeTab === "mpesa" ? "border-b-2 border-green-600 text-green-600 font-semibold" : "text-gray-600"}`}
          >
            <FaMoneyBillWave /> M-Pesa
          </button>
          <button
            onClick={() => setActiveTab("stripe")}
            className={`flex items-center gap-2 pb-2 ${activeTab === "stripe" ? "border-b-2 border-indigo-600 text-indigo-600 font-semibold" : "text-gray-600"}`}
          >
            <FaStripe /> Stripe
          </button>
          <button
            onClick={() => setActiveTab("paypal")}
            className={`flex items-center gap-2 pb-2 ${activeTab === "paypal" ? "border-b-2 border-blue-600 text-blue-600 font-semibold" : "text-gray-600"}`}
          >
            <FaPaypal /> PayPal
          </button>
        </div>

        {loading && <p className="text-sm text-gray-500 mb-3">Loading...</p>}

        {/* Forms */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {activeTab === "mpesa" && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold">M-Pesa Settings</h3>
              {["businessName","paybillShortcode","paybillPasskey","buyGoodsTill","buyGoodsPasskey"].map((field) => (
                <input
                  key={field}
                  type="text"
                  placeholder={field.replace(/([A-Z])/g, " $1")}
                  value={formData.mpesa[field]}
                  onChange={(e) => handleChange("mpesa", field, e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  required
                />
              ))}
            </div>
          )}

          {activeTab === "stripe" && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold">Stripe Settings</h3>
              {["publishableKey","secretKey"].map((field) => (
                <input
                  key={field}
                  type="text"
                  placeholder={field.replace(/([A-Z])/g, " $1")}
                  value={formData.stripe[field]}
                  onChange={(e) => handleChange("stripe", field, e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  required
                />
              ))}
            </div>
          )}

          {activeTab === "paypal" && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold">PayPal Settings</h3>
              {["clientId","clientSecret"].map((field) => (
                <input
                  key={field}
                  type="text"
                  placeholder={field.replace(/([A-Z])/g, " $1")}
                  value={formData.paypal[field]}
                  onChange={(e) => handleChange("paypal", field, e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  required
                />
              ))}
            </div>
          )}

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
