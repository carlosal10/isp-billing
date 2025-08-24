import { useState } from "react";
import { FaTimes } from "react-icons/fa";
import "./ConnectMikrotikModal.css"; // ✅ custom styles

export default function ConnectMikrotikModal({ isOpen, onClose }) {
  const [formData, setFormData] = useState({
    ip: "",
    username: "",
    password: "",
  });

  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState("");

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { id, value } = e.target;
    setFormData((prev) => ({ ...prev, [id]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setResponse("");

    try {
      const res = await fetch(
        "https://isp-billing-uq58.onrender.com/api/mikrotik/connect",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host: formData.ip,
            user: formData.username,
            password: formData.password,
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Connection failed");

      setResponse("✅ Connected successfully to MikroTik Router!");
    } catch (err) {
      setResponse("❌ " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mikrotik-overlay">
      <div className="mikrotik-modal">
        {/* Close Button */}
        <button onClick={onClose} className="close-btn">
          <FaTimes size={20} />
        </button>

        <h2 className="modal-title">Connect To Mikrotik</h2>

        {/* Form */}
        <form onSubmit={handleSubmit} className="modal-form">
          <label>
            Router IP:
            <input
              type="text"
              id="ip"
              value={formData.ip}
              onChange={handleChange}
              required
            />
          </label>

          <label>
            Username:
            <input
              type="text"
              id="username"
              value={formData.username}
              onChange={handleChange}
              required
            />
          </label>

          <label>
            Password:
            <input
              type="password"
              id="password"
              value={formData.password}
              onChange={handleChange}
              required
            />
          </label>

          <button type="submit" disabled={loading} className="submit-btn">
            {loading ? "Connecting..." : "Connect"}
          </button>
        </form>

        {response && <div className="response-msg">{response}</div>}
      </div>
    </div>
  );
}
