import React, { useState, useEffect } from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd } from "react-icons/md";
import { AiOutlineEdit } from "react-icons/ai";
import { RiDeleteBinLine } from "react-icons/ri";
import "./PlanModal.css";

export default function PlanModal({ isOpen, onClose }) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("Add");
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [selectedDeleteId, setSelectedDeleteId] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    price: "",
    duration: "",
    speed: "",
    rateLimit: "",
    dataCap: ""
  });

  const API_URL = "https://isp-billing-uq58.onrender.com/api/plans";

  useEffect(() => {
    if (isOpen) fetchPlans();
  }, [isOpen]);

  const fetchPlans = async () => {
    try {
      setLoading(true);
      const res = await fetch(API_URL);
      const data = await res.json();
      setPlans(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Error fetching plans:", err);
    } finally {
      setLoading(false);
    }
  };

  // ----------------- Handlers -----------------
  const handleAddPlan = async (e) => {
    e.preventDefault();
    const form = e.target;
    const body = {
      name: form.planName.value,
      description: form.planDescription.value || "Internet Plan",
      price: form.planPrice.value,
      duration: form.planDuration.value,
      speed: form.planSpeed.value,
      rateLimit: form.planRateLimit.value,
      dataCap: form.planDataCap.value || null
    };

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        fetchPlans();
        form.reset();
      }
    } catch (err) {
      console.error("Error adding plan:", err);
    }
  };

  const handleSelectPlan = (id) => {
    setSelectedPlanId(id);
    const plan = plans.find((p) => p._id === id);
    if (plan) {
      setFormData({
        name: plan.name,
        price: parseFloat(plan.price),
        duration: plan.duration,
        speed: plan.speed || "",
        rateLimit: plan.rateLimit || "",
        dataCap: plan.dataCap || ""
      });
    }
  };

  const handleUpdatePlan = async (e) => {
    e.preventDefault();
    if (!selectedPlanId) return;

    const body = { ...formData };
    try {
      const res = await fetch(`${API_URL}/${selectedPlanId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        fetchPlans();
        setSelectedPlanId("");
        setFormData({ name: "", price: "", duration: "", speed: "", rateLimit: "", dataCap: "" });
      }
    } catch (err) {
      console.error("Error updating plan:", err);
    }
  };

  const handleDeletePlan = async (e) => {
    e.preventDefault();
    if (!selectedDeleteId) return;

    try {
      const res = await fetch(`${API_URL}/${selectedDeleteId}`, {
        method: "DELETE"
      });
      if (res.ok) {
        fetchPlans();
        setSelectedDeleteId("");
      }
    } catch (err) {
      console.error("Error deleting plan:", err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content plan-modal">
        <span className="close" onClick={onClose}><FaTimes /></span>
        <h2>Manage Plans</h2>

        {/* Tabs */}
        <div className="tabs">
          {["Add", "Update", "Remove"].map(tab => (
            <button
              key={tab}
              className={`tab-btn ${activeTab === tab ? "active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="tab-content">
          {/* Add Plan */}
          {activeTab === "Add" && (
            <form onSubmit={handleAddPlan}>
              <input type="text" name="planName" placeholder="Plan Name" required />
              <input type="number" name="planPrice" placeholder="Price (KES)" required />
              <input type="text" name="planDuration" placeholder="Duration (e.g. 30 days)" required />
              <input type="number" name="planSpeed" placeholder="Speed (Mbps)" required />
              <input type="text" name="planRateLimit" placeholder="Rate Limit (e.g., 10M/10M)" required />
              <input type="number" name="planDataCap" placeholder="Data Cap (GB, optional)" />
              <button type="submit"><MdAdd className="inline-icon" /> Add Plan</button>
            </form>
          )}

          {/* Update Plan */}
          {activeTab === "Update" && (
            <>
              <select value={selectedPlanId} onChange={(e) => handleSelectPlan(e.target.value)} required>
                <option value="">-- Select Plan to Update --</option>
                {plans.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name} ({p.price} KES)
                  </option>
                ))}
              </select>
              {selectedPlanId && (
                <form onSubmit={handleUpdatePlan}>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Name"
                  />
                  <input
                    type="number"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                    placeholder="Price"
                  />
                  <input
                    type="text"
                    value={formData.duration}
                    onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
                    placeholder="Duration"
                  />
                  <input
                    type="number"
                    value={formData.speed}
                    onChange={(e) => setFormData({ ...formData, speed: e.target.value })}
                    placeholder="Speed (Mbps)"
                  />
                  <input
                    type="text"
                    value={formData.rateLimit}
                    onChange={(e) => setFormData({ ...formData, rateLimit: e.target.value })}
                    placeholder="Rate Limit"
                  />
                  <input
                    type="number"
                    value={formData.dataCap}
                    onChange={(e) => setFormData({ ...formData, dataCap: e.target.value })}
                    placeholder="Data Cap (GB)"
                  />
                  <button type="submit"><AiOutlineEdit className="inline-icon" /> Update Plan</button>
                </form>
              )}
            </>
          )}

          {/* Remove Plan */}
          {activeTab === "Remove" && (
            <form onSubmit={handleDeletePlan}>
              <select value={selectedDeleteId} onChange={(e) => setSelectedDeleteId(e.target.value)} required>
                <option value="">-- Select Plan to Remove --</option>
                {plans.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name} ({p.price} KES)
                  </option>
                ))}
              </select>
              <button type="submit" className="remove-btn"><RiDeleteBinLine className="inline-icon" /> Remove Plan</button>
            </form>
          )}
        </div>

        {/* Display all plans */}
        <h3>Available Plans</h3>
        {loading ? (
          <p>Loading plans...</p>
        ) : (
          <ul className="plan-list">
            {plans.map(plan => (
              <li key={plan._id}>
                <strong>{plan.name}</strong> - {plan.price} | {plan.duration} | {plan.speed} Mbps | {plan.rateLimit} | {plan.dataCap ? `${plan.dataCap}GB` : "No cap"}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
