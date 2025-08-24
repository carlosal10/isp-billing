import React, { useState, useEffect } from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd } from "react-icons/md";
import { AiOutlineEdit } from "react-icons/ai";
import { RiDeleteBinLine } from "react-icons/ri";
import './HotspotModal.css'; // ✅ custom styles

const API_URL = "https://isp-billing-uq58.onrender.com/api/hotspot-plans";

export default function HotspotModal({ isOpen, onClose }) {
  const [plans, setPlans] = useState([]);
  const [form, setForm] = useState({
    name: "",
    price: "",
    duration: "",
    speed: "",
    server: "",
    profile: "",
    secret: "",
  });

  // Fetch plans on open
  useEffect(() => {
    if (isOpen) fetchPlans();
  }, [isOpen]);

  const fetchPlans = async () => {
    try {
      const res = await fetch(API_URL);
      const data = await res.json();
      setPlans(data);
    } catch (err) {
      console.error("Error fetching plans:", err);
    }
  };

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        await fetchPlans();
        setForm({ name: "", price: "", duration: "", speed: "", server: "", profile: "", secret: "" });
      }
    } catch (err) {
      console.error("Error adding plan:", err);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this plan?")) return;
    try {
      await fetch(`${API_URL}/${id}`, { method: "DELETE" });
      fetchPlans();
    } catch (err) {
      console.error("Error deleting plan:", err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        {/* Close Button */}
        <span className="close" onClick={onClose}>
          <FaTimes />
        </span>

        <h2>Configure Hotspot Plan</h2>

        {/* Hotspot Plan Form */}
        <form id="hotspotPlanForm" onSubmit={handleSubmit}>
          <fieldset>
            <legend>Plan Details</legend>
            <input type="text" name="name" value={form.name} onChange={handleChange} placeholder="Plan Name" required />
            <input type="number" name="price" value={form.price} onChange={handleChange} placeholder="Price (KES)" required />
            <input type="text" name="duration" value={form.duration} onChange={handleChange} placeholder="Duration (e.g., 1h, 1d, 30d)" required />
            <input type="text" name="speed" value={form.speed} onChange={handleChange} placeholder="Speed (e.g., 2M/1M)" required />
          </fieldset>

          <fieldset>
            <legend>MikroTik Hotspot Settings</legend>
            <input type="text" name="server" value={form.server} onChange={handleChange} placeholder="Hotspot Server" required />
            <input type="text" name="profile" value={form.profile} onChange={handleChange} placeholder="Hotspot Profile" required />
            <input type="text" name="secret" value={form.secret} onChange={handleChange} placeholder="Shared Secret (if any)" />
          </fieldset>

          <button type="submit">
            <MdAdd className="inline-icon" /> Save Plan
          </button>
        </form>

        {/* Table of Hotspot Plans */}
        <div className="table-container">
          <h3>Available Hotspot Plans</h3>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Price</th>
                <th>Duration</th>
                <th>Speed</th>
                <th>Server</th>
                <th>Profile</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {plans.length > 0 ? (
                plans.map((plan) => (
                  <tr key={plan._id}>
                    <td>{plan.name}</td>
                    <td>{plan.price}</td>
                    <td>{plan.duration}</td>
                    <td>{plan.speed}</td>
                    <td>{plan.server}</td>
                    <td>{plan.profile}</td>
                    <td>
                      <button className="action-btn edit">
                        <AiOutlineEdit />
                      </button>
                      <button className="action-btn delete" onClick={() => handleDelete(plan._id)}>
                        <RiDeleteBinLine />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="7">No plans found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
