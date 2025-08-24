import { useState } from "react";
import { FaTimes, FaStripe, FaPaypal, FaMoneyBillWave } from "react-icons/fa";

export default function PaymentIntegrationsModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState("mpesa");

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

  if (!isOpen) return null;

  const handleChange = (provider, field, value) => {
    setFormData((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], [field]: value },
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    console.log("Payment Integrations Submitted:", formData);
    // 🔗 API call will go here later
    onClose();
  };

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

        <h2 className="text-2xl font-bold mb-4">Payment Integrations</h2>

        {/* Tabs */}
        <div className="flex space-x-4 border-b mb-4">
          <button
            onClick={() => setActiveTab("mpesa")}
            className={`flex items-center gap-2 pb-2 ${
              activeTab === "mpesa"
                ? "border-b-2 border-green-600 text-green-600 font-semibold"
                : "text-gray-600"
            }`}
          >
            <FaMoneyBillWave /> M-Pesa
          </button>
          <button
            onClick={() => setActiveTab("stripe")}
            className={`flex items-center gap-2 pb-2 ${
              activeTab === "stripe"
                ? "border-b-2 border-indigo-600 text-indigo-600 font-semibold"
                : "text-gray-600"
            }`}
          >
            <FaStripe /> Stripe
          </button>
          <button
            onClick={() => setActiveTab("paypal")}
            className={`flex items-center gap-2 pb-2 ${
              activeTab === "paypal"
                ? "border-b-2 border-blue-600 text-blue-600 font-semibold"
                : "text-gray-600"
            }`}
          >
            <FaPaypal /> PayPal
          </button>
        </div>

        {/* Forms */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {activeTab === "mpesa" && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold">M-Pesa Settings</h3>
              <input
                type="text"
                placeholder="Business Name"
                value={formData.mpesa.businessName}
                onChange={(e) => handleChange("mpesa", "businessName", e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                required
              />
              <input
                type="text"
                placeholder="Paybill Short Code"
                value={formData.mpesa.paybillShortcode}
                onChange={(e) => handleChange("mpesa", "paybillShortcode", e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                required
              />
              <input
                type="text"
                placeholder="Paybill Passkey"
                value={formData.mpesa.paybillPasskey}
                onChange={(e) => handleChange("mpesa", "paybillPasskey", e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                required
              />
              <input
                type="text"
                placeholder="Buy Goods Till Number"
                value={formData.mpesa.buyGoodsTill}
                onChange={(e) => handleChange("mpesa", "buyGoodsTill", e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                required
              />
              <input
                type="text"
                placeholder="Buy Goods Passkey"
                value={formData.mpesa.buyGoodsPasskey}
                onChange={(e) => handleChange("mpesa", "buyGoodsPasskey", e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                required
              />
            </div>
          )}

          {activeTab === "stripe" && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold">Stripe Settings</h3>
              <input
                type="text"
                placeholder="Publishable Key"
                value={formData.stripe.publishableKey}
                onChange={(e) => handleChange("stripe", "publishableKey", e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                required
              />
              <input
                type="text"
                placeholder="Secret Key"
                value={formData.stripe.secretKey}
                onChange={(e) => handleChange("stripe", "secretKey", e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                required
              />
            </div>
          )}

          {activeTab === "paypal" && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold">PayPal Settings</h3>
              <input
                type="text"
                placeholder="Client ID"
                value={formData.paypal.clientId}
                onChange={(e) => handleChange("paypal", "clientId", e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                required
              />
              <input
                type="text"
                placeholder="Client Secret"
                value={formData.paypal.clientSecret}
                onChange={(e) => handleChange("paypal", "clientSecret", e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                required
              />
            </div>
          )}

          <button
            type="submit"
            className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 transition"
          >
            Save Settings
          </button>
        </form>
      </div>
    </div>
  );
}
