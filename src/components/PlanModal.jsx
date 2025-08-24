import React, { useState, useEffect } from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd } from "react-icons/md";
import { AiOutlineEdit } from "react-icons/ai";
import { RiDeleteBinLine } from "react-icons/ri";
import "./PlanModal.css"; // ✅ custom styles

export default function PlanModal({ isOpen, onClose }) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);
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
      setPlans(data);
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
    const form = e.target;
    const planId = form.planId.value;

    const body = {
      name: form.newName.value,
      price: form.newPrice.value,
      duration: form.newDuration.value,
    };

    try {
      const res = await fetch(`${API_URL}/${planId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        fetchPlans();
        form.reset();
      }
    } catch (err) {
      console.error("Error updating plan:", err);
    }
  };

  // Delete Plan
  const handleDeletePlan = async (e) => {
    e.preventDefault();
    const form = e.target;
    const planId = form.planId.value;

    try {
      const res = await fetch(`${API_URL}/${planId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchPlans();
        form.reset();
      }
    } catch (err) {
      console.error("Error deleting plan:", err);
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
          <input type="text" name="planId" placeholder="Plan ID" required />
          <input type="text" name="newName" placeholder="New Name" />
          <input type="number" name="newPrice" placeholder="New Price" />
          <input type="text" name="newDuration" placeholder="New Duration" />
          <button type="submit">
            <AiOutlineEdit className="inline-icon" /> Update Plan
          </button>
        </form>

        {/* Remove Plan */}
        <form id="removePlanForm" onSubmit={handleDeletePlan}>
          <input type="text" name="planId" placeholder="Plan ID" required />
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
