import { Field } from "./ui/Field";
// src/components/PlanModal.jsx
import React, { useState, useEffect } from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd } from "react-icons/md";
import { AiOutlineEdit } from "react-icons/ai";
import { RiDeleteBinLine } from "react-icons/ri";
import { api } from "../lib/apiClient"; // ✅ use authenticated axios
import "./PlanModal.css";


export default function PlanModal({ isOpen = false, onClose, standalone = false }) {
  const visible = standalone || isOpen;
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





  useEffect(() => {
    if (visible) fetchPlans();
  }, [visible]);

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

  if (!visible) return null;

  const content = (
      <div  className={`modal-content plan-modal ${standalone ? "tool-page-card" : "dialog-surface"}`}>
        {!standalone ? <span className="close" onClick={onClose}><FaTimes /></span> : null}
        <h2>Manage Plans</h2>
        {msg && <p className="status-msg">{msg}</p>}

        {/* Tabs */}
        <div className="tabs">
          {["Add", "Update", "Remove"].map((tab) => (
            <button
              type="button"
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
              <Field label="Plan Name"><input type="text" name="planName" placeholder="Plan Name" required /></Field>
              <Field label="Price (KES)"><input type="number" min="0" step="0.01" name="planPrice" placeholder="Price (KES)" required /></Field>
              <Field label="Duration (e.g. 30 days)"><input type="text" name="planDuration" placeholder="Duration (e.g. 30 days)" required /></Field>
              <Field label="Speed (Mbps)"><input type="number" min="0" step="1" name="planSpeed" placeholder="Speed (Mbps)" required /></Field>
              <Field label="Rate Limit (e.g., 10M/10M)"><input type="text" name="planRateLimit" placeholder="Rate Limit (e.g., 10M/10M)" required /></Field>
              <Field label="Data Cap (GB, optional)"><input type="number" min="0" step="1" name="planDataCap" placeholder="Data Cap (GB, optional)" /></Field>
              <button type="submit" disabled={loading}>
                <MdAdd className="inline-icon" /> Add Plan
              </button>
            </form>
          )}

          {/* Update Plan */}
          {activeTab === "Update" && (
            <>
              <Field label="Select Plan to Update"><select
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
              </select></Field>

              {selectedPlanId && (
                <form onSubmit={handleUpdatePlan}>
                  <Field label="Name"><input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Name"
                    required
                  /></Field>
                  <Field label="Price"><input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                    placeholder="Price"
                    required
                  /></Field>
                  <Field label="Duration"><input
                    type="text"
                    value={formData.duration}
                    onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
                    placeholder="Duration"
                    required
                  /></Field>
                  <Field label="Speed (Mbps)"><input
                    type="number"
                    min="0"
                    step="1"
                    value={formData.speed}
                    onChange={(e) => setFormData({ ...formData, speed: e.target.value })}
                    placeholder="Speed (Mbps)"
                  /></Field>
                  <Field label="Rate Limit"><input
                    type="text"
                    value={formData.rateLimit}
                    onChange={(e) => setFormData({ ...formData, rateLimit: e.target.value })}
                    placeholder="Rate Limit"
                  /></Field>
                  <Field label="Data Cap (GB)"><input
                    type="number"
                    min="0"
                    step="1"
                    value={formData.dataCap}
                    onChange={(e) => setFormData({ ...formData, dataCap: e.target.value })}
                    placeholder="Data Cap (GB)"
                  /></Field>
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
              <Field label="Select Plan to Remove"><select
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
              </select></Field>
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
  );

  return standalone ? <section className="tool-page-shell">{content}</section> : <div className="modal-overlay">{content}</div>;
}
