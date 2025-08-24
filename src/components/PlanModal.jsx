import React, { useState, useEffect } from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd } from "react-icons/md";
import { AiOutlineEdit } from "react-icons/ai";
import { RiDeleteBinLine } from "react-icons/ri";
import "./PlanModal.css";

export default function PlanModal({ isOpen, onClose }) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState(""); // for update
  const [selectedDeleteId, setSelectedDeleteId] = useState(""); // for delete
  const [formData, setFormData] = useState({ name: "", price: "", duration: "" });

  const API_URL = "https://isp-billing-uq58.onrender.com/api/plans";

  // Fetch plans when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchPlans();
    }
  }, [isOpen]);

  const fetchPlans = async () => {
    try {
      setLoading(true);
      const res = await fetch(API_URL);
      const data = await res.json();
      setPlans(Array.isArray(data) ? data : []); // ✅ ensure array
      setLoading(false);
    } catch (err) {
      console.error("Error fetching plans:", err);
      setLoading(false);
    }
  };

  // Add Plan
  const handleAddPlan = async (e) => {
    e.preventDefault();
    const form = e.target;
    const body = {
      name: form.planName.value,
      description: "Internet Plan",
      price: form.planPrice.value,
      duration: form.planDuration.value || "30 days",
    };

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        fetchPlans();
        form.reset();
      }
    } catch (err) {
      console.error("Error adding plan:", err);
    }
  };

  // Update Plan
  const handleUpdatePlan = async (e) => {
    e.preventDefault();
    if (!selectedPlanId) return;

    const body = {
      name: formData.name,
      price: formData.price,
      duration: formData.duration,
    };

    try {
      const res = await fetch(`${API_URL}/${selectedPlanId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        fetchPlans();
        setSelectedPlanId("");
        setFormData({ name: "", price: "", duration: "" });
      }
    } catch (err) {
      console.error("Error updating plan:", err);
    }
  };

  // Delete Plan
  const handleDeletePlan = async (e) => {
    e.preventDefault();
    if (!selectedDeleteId) return;

    try {
      const res = await fetch(`${API_URL}/${selectedDeleteId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchPlans();
        setSelectedDeleteId("");
      }
    } catch (err) {
      console.error("Error deleting plan:", err);
    }
  };

  // When selecting a plan for update, prefill inputs
  const handleSelectPlan = (id) => {
    setSelectedPlanId(id);
    const plan = plans.find((p) => p._id === id);
    if (plan) {
      setFormData({
        name: plan.name,
        price: plan.price,
        duration: plan.duration,
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <span className="close" onClick={onClose}>
          <FaTimes />
        </span>

        <h2>Manage Plans</h2>

        {/* Add Plan */}
        <form id="addPlanForm" onSubmit={handleAddPlan}>
          <input type="text" name="planName" placeholder="Plan Name" required />
          <input type="number" name="planPrice" placeholder="Price (KES)" required />
          <input type="text" name="planDuration" placeholder="Duration (e.g. 30 days)" required />
          <button type="submit">
            <MdAdd className="inline-icon" /> Add Plan
          </button>
        </form>

        {/* Update Plan */}
        <form id="updatePlanForm" onSubmit={handleUpdatePlan}>
          <select
            value={selectedPlanId}
            onChange={(e) => handleSelectPlan(e.target.value)}
            required
          >
            <option value="">-- Select a Plan to Update --</option>
            {plans.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name} ({p.price} KES)
              </option>
            ))}
          </select>

          {selectedPlanId && (
            <>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="New Name"
              />
              <input
                type="number"
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                placeholder="New Price"
              />
              <input
                type="text"
                value={formData.duration}
                onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
                placeholder="New Duration"
              />
              <button type="submit">
                <AiOutlineEdit className="inline-icon" /> Update Plan
              </button>
            </>
          )}
        </form>

        {/* Remove Plan */}
        <form id="removePlanForm" onSubmit={handleDeletePlan}>
          <select
            value={selectedDeleteId}
            onChange={(e) => setSelectedDeleteId(e.target.value)}
            required
          >
            <option value="">-- Select a Plan to Remove --</option>
            {plans.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name} ({p.price} KES)
              </option>
            ))}
          </select>
          <button type="submit" className="remove-btn">
            <RiDeleteBinLine className="inline-icon" /> Remove Plan
          </button>
        </form>

        <h3>Available Plans</h3>
        {loading ? (
          <p>Loading plans...</p>
        ) : (
          <ul className="plan-list">
            {plans.map((plan) => (
              <li key={plan._id}>
                <strong>{plan.name}</strong> - {plan.price} ({plan.duration})
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
