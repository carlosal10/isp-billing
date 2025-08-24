import { useState } from "react";
import { FaTimes } from "react-icons/fa";

export default function MessagingModal({ isOpen, onClose }) {
  const [formData, setFormData] = useState({
    channel: "sms",
    recipient: "",
    message: "",
  });
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState("");

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { id, value } = e.target;
    setFormData((prev) => ({ ...prev, [id]: value }));
  };

  const handleChannelChange = (e) => {
    setFormData((prev) => ({ ...prev, channel: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setResponse("");

    try {
      // 🔹 Replace with actual API call later
      // Example: await axios.post(`/api/send-${formData.channel}`, formData);

      setTimeout(() => {
        setLoading(false);
        setResponse(`✅ ${formData.channel.toUpperCase()} sent successfully!`);
        setFormData({ channel: "sms", recipient: "", message: "" });
      }, 1500);
    } catch (err) {
      setLoading(false);
      setResponse(`❌ Failed to send via ${formData.channel.toUpperCase()}`);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
      <div className="bg-white p-6 rounded-2xl shadow-lg w-full max-w-md relative">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-500 hover:text-red-500"
        >
          <FaTimes size={20} />
        </button>

        {/* Title */}
        <h2 className="text-xl font-bold mb-4">Send Message</h2>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Channel Selector */}
          <div>
            <label
              htmlFor="channel"
              className="block font-medium text-sm mb-1"
            >
              Select Channel:
            </label>
            <select
              id="channel"
              value={formData.channel}
              onChange={handleChannelChange}
              className="w-full p-2 border rounded-lg"
            >
              <option value="sms">SMS</option>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
          </div>

          {/* Recipient */}
          <div>
            <label
              htmlFor="recipient"
              className="block font-medium text-sm mb-1"
            >
              Recipient:
            </label>
            <input
              type="text"
              id="recipient"
              value={formData.recipient}
              onChange={handleChange}
              placeholder="Enter recipient address/number"
              required
              className="w-full p-2 border rounded-lg"
            />
          </div>

          {/* Message */}
          <div>
            <label
              htmlFor="message"
              className="block font-medium text-sm mb-1"
            >
              Message:
            </label>
            <textarea
              id="message"
              value={formData.message}
              onChange={handleChange}
              placeholder="Type your message here..."
              rows={4}
              required
              className="w-full p-2 border rounded-lg"
            />
          </div>

          <button
            type="submit"
            className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 w-full"
            disabled={loading}
          >
            {loading ? "Sending..." : "Send"}
          </button>
        </form>

        {/* Response */}
        {response && (
          <div className="mt-4 text-center font-semibold text-sm">
            {response}
          </div>
        )}
      </div>
    </div>
  );
}
