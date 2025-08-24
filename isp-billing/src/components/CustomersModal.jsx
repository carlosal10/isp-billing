import React, { useState } from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd } from "react-icons/md";
import { AiOutlineEdit } from "react-icons/ai";
import { RiDeleteBinLine } from "react-icons/ri";

export default function CustomersModal({ isOpen, onClose }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  if (!isOpen) return null;

  // Generic fetch wrapper
  const sendRequest = async (url, method, body) => {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setMessage(data.message || "Success ✅");
    } catch (err) {
      setMessage("❌ Error connecting to server");
    } finally {
      setLoading(false);
    }
  };

  // Handlers
  const handleAdd = (e) => {
    e.preventDefault();
    const body = {
      name: e.target[0].value,
      email: e.target[1].value,
      phone: e.target[2].value,
      address: e.target[3].value,
    };
    sendRequest("https://isp-billing-uq58.onrender.com/api/customers/add", "POST", body);
    e.target.reset();
  };

  const handleUpdate = (e) => {
    e.preventDefault();
    const id = e.target[0].value;
    const body = {
      email: e.target[1].value,
      phone: e.target[2].value,
      address: e.target[3].value,
    };
    sendRequest(`https://isp-billing-uq58.onrender.com/api/customers/update/${id}`, "PUT", body);
    e.target.reset();
  };

  const handleRemove = (e) => {
    e.preventDefault();
    const id = e.target[0].value;
    sendRequest(`https://isp-billing-uq58.onrender.com/api/customers/remove/${id}`, "DELETE", {});
    e.target.reset();
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content customers-modal">
        <span className="close" onClick={onClose}>
          <FaTimes />
        </span>

        <h2>Manage Customers</h2>

        {message && <p className="status-msg">{message}</p>}

        {/* Add Customer */}
        <form onSubmit={handleAdd}>
          <input type="text" placeholder="Full Name" required />
          <input type="email" placeholder="Email" required />
          <input type="tel" placeholder="Phone Number" required />
          <input type="text" placeholder="Address" required />
          <button type="submit" disabled={loading}>
            <MdAdd className="inline-icon" /> Add Customer
          </button>
        </form>

        {/* Update Customer */}
        <form onSubmit={handleUpdate}>
          <input type="text" placeholder="Customer ID / Username" required />
          <input type="email" placeholder="New Email" />
          <input type="tel" placeholder="New Phone" />
          <input type="text" placeholder="New Address" />
          <button type="submit" disabled={loading}>
            <AiOutlineEdit className="inline-icon" /> Update Customer
          </button>
        </form>

        {/* Remove Customer */}
        <form onSubmit={handleRemove}>
          <input type="text" placeholder="Customer ID / Username" required />
          <button type="submit" className="remove-btn" disabled={loading}>
            <RiDeleteBinLine className="inline-icon" /> Remove Customer
          </button>
        </form>
      </div>
    </div>
  );
}
