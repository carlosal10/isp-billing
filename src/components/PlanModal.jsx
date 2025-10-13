// src/components/PlanModal.jsx
import React, { useState, useEffect, useRef } from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd } from "react-icons/md";
import { AiOutlineEdit } from "react-icons/ai";
import { RiDeleteBinLine } from "react-icons/ri";
import { api } from "../lib/apiClient"; // ✅ use authenticated axios
import "./PlanModal.css";
import useDragResize from "../hooks/useDragResize";

export default function PlanModal({ isOpen, onClose }) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [activeTab, setActiveTab] = useState("Add");
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [selectedDeleteId, setSelectedDeleteId] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    price: "",
    duration: "",
    speed: "",
    rateLimit: "",
    dataCap: "",
  });
  const containerRef = useRef(null);
  const dragHandleRef = useRef(null);
  const { getResizeHandleProps } = useDragResize({
    isOpen,
    containerRef,
    handleRef: dragHandleRef,
    minWidth: 640,
    minHeight: 560,
    defaultSize: { width: 920, height: 640 },
  });
  const resizeHandles = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

  useEffect(() => {
    if (isOpen) fetchPlans();
  }, [isOpen]);

  const fetchPlans = async () => {
    try {
      setLoading(true);
      setMsg("");
      const { data } = await api.get(`/plans`);
      setPlans(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Error fetching plans:", err);
      setMsg(err?.response?.data?.error || err?.message || "Failed to load plans");
    } finally {
      setLoading(false);
    }
  };

  // ----------------- Handlers -----------------
  const handleAddPlan = async (e) => {
    e.preventDefault();
    setMsg("");
    const form = e.target;
    const body = {
      name: form.planName.value.trim(),
      price: Number(form.planPrice.value),
      duration: form.planDuration.value.trim(),
      speed: Number(form.planSpeed.value),
      rateLimit: form.planRateLimit.value.trim(),
      dataCap: form.planDataCap.value ? Number(form.planDataCap.value) : null,
    };

    try {
      await api.post(`/plans`, body);
      setMsg("✅ Plan added");
      await fetchPlans();
      form.reset();
    } catch (err) {
      console.error("Error adding plan:", err);
      setMsg(err?.response?.data?.error || err?.message || "Failed to add plan");
    }
  };

  const handleSelectPlan = (id) => {
    setSelectedPlanId(id);
    const plan = plans.find((p) => p._id === id);
    if (plan) {
      setFormData({
        name: plan.name || "",
        price: Number(plan.price) || "",
        duration: plan.duration || "",
        speed: Number(plan.speed) || "",
        rateLimit: plan.rateLimit || "",
        dataCap: plan.dataCap != null ? Number(plan.dataCap) : "",
      });
      setMsg("");
    }
  };

  const handleUpdatePlan = async (e) => {
    e.preventDefault();
    if (!selectedPlanId) return;
    setMsg("");

    const body = {
      name: String(formData.name).trim(),
      price: formData.price === "" ? null : Number(formData.price),
      duration: String(formData.duration).trim(),
      speed: formData.speed === "" ? null : Number(formData.speed),
      rateLimit: String(formData.rateLimit).trim(),
      dataCap: formData.dataCap === "" ? null : Number(formData.dataCap),
    };

    try {
      await api.put(`/plans/${selectedPlanId}`, body);
      setMsg("✅ Plan updated");
      await fetchPlans();
      setSelectedPlanId("");
      setFormData({ name: "", price: "", duration: "", speed: "", rateLimit: "", dataCap: "" });
    } catch (err) {
      console.error("Error updating plan:", err);
      setMsg(err?.response?.data?.error || err?.message || "Failed to update plan");
    }
  };

  const handleDeletePlan = async (e) => {
    e.preventDefault();
    if (!selectedDeleteId) return;
    setMsg("");

    try {
      await api.delete(`/plans/${selectedDeleteId}`);
      setMsg("✅ Plan removed");
      await fetchPlans();
      setSelectedDeleteId("");
    } catch (err) {
      console.error("Error deleting plan:", err);
      setMsg(err?.response?.data?.error || err?.message || "Failed to delete plan");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div ref={containerRef} className="modal-content plan-modal draggable-modal">
        <div className="modal-drag-bar" ref={dragHandleRef}>Drag</div>
        {resizeHandles.map((dir) => (
          <div
            key={dir}
            className={`modal-resize-handle ${
              dir.length === 1 ? "edge" : "corner"
            } ${["n", "s"].includes(dir) ? "horizontal" : ""} ${["e", "w"].includes(dir) ? "vertical" : ""} ${dir}`}
            {...getResizeHandleProps(dir)}
          />
        ))}
        <span className="close" onClick={onClose} data-modal-no-drag><FaTimes /></span>
        <h2>Manage Plans</h2>
        {msg && <p className="status-msg">{msg}</p>}

        {/* Tabs */}
        <div className="tabs">
          {["Add", "Update", "Remove"].map((tab) => (
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
              <input type="number" min="0" step="0.01" name="planPrice" placeholder="Price (KES)" required />
              <input type="text" name="planDuration" placeholder="Duration (e.g. 30 days)" required />
              <input type="number" min="0" step="1" name="planSpeed" placeholder="Speed (Mbps)" required />
              <input type="text" name="planRateLimit" placeholder="Rate Limit (e.g., 10M/10M)" required />
              <input type="number" min="0" step="1" name="planDataCap" placeholder="Data Cap (GB, optional)" />
              <button type="submit" disabled={loading}>
                <MdAdd className="inline-icon" /> Add Plan
              </button>
            </form>
          )}

          {/* Update Plan */}
          {activeTab === "Update" && (
            <>
              <select
                value={selectedPlanId}
                onChange={(e) => handleSelectPlan(e.target.value)}
                required
              >
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
                    required
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                    placeholder="Price"
                    required
                  />
                  <input
                    type="text"
                    value={formData.duration}
                    onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
                    placeholder="Duration"
                    required
                  />
                  <input
                    type="number"
                    min="0"
                    step="1"
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
                    min="0"
                    step="1"
                    value={formData.dataCap}
                    onChange={(e) => setFormData({ ...formData, dataCap: e.target.value })}
                    placeholder="Data Cap (GB)"
                  />
                  <button type="submit" disabled={loading}>
                    <AiOutlineEdit className="inline-icon" /> Update Plan
                  </button>
                </form>
              )}
            </>
          )}

          {/* Remove Plan */}
          {activeTab === "Remove" && (
            <form onSubmit={handleDeletePlan}>
              <select
                value={selectedDeleteId}
                onChange={(e) => setSelectedDeleteId(e.target.value)}
                required
              >
                <option value="">-- Select Plan to Remove --</option>
                {plans.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name} ({p.price} KES)
                  </option>
                ))}
              </select>
              <button type="submit" className="remove-btn" disabled={loading || !selectedDeleteId}>
                <RiDeleteBinLine className="inline-icon" /> Remove Plan
              </button>
            </form>
          )}
        </div>

        {/* Display all plans */}
        <h3>Available Plans</h3>
        {loading ? (
          <p>Loading plans...</p>
        ) : (
          <ul className="plan-list">
            {plans.map((plan) => (
              <li key={plan._id}>
                <strong>{plan.name}</strong> — {plan.price} KES | {plan.duration} |{" "}
                {plan.speed} Mbps | {plan.rateLimit} |{" "}
                {plan.dataCap ? `${plan.dataCap}GB` : "No cap"}
              </li>
            ))}
            {plans.length === 0 && <li>No plans found.</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
