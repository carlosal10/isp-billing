// src/components/HotspotModal.jsx
import React, { useEffect, useState } from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd } from "react-icons/md";
import { AiOutlineEdit } from "react-icons/ai";
import { RiDeleteBinLine } from "react-icons/ri";
import "./HotspotModal.css";
import { api } from "../lib/apiClient";

export default function HotspotModal({ isOpen, onClose }) {
  const [plans, setPlans] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const [form, setForm] = useState({
    name: "",
    price: "",
    duration: "",
    speed: "",
    server: "",
    profile: "",
    secret: "",
  });

  useEffect(() => {
    if (!isOpen) return;
    setMsg("");
    loadPlans();
  }, [isOpen]);

  async function loadPlans() {
    try {
      const { data } = await api.get("/hotspot-plans");
      setPlans(Array.isArray(data) ? data : []);
      setMsg("");
    } catch (e) {
      console.error("Load hotspot plans failed:", e?.__debug || e);
      setMsg(`❌ Failed to load plans${e?.message ? `: ${e.message}` : ""}`);
    }
  }

  function onChange(e) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      const payload = {
        name: form.name.trim(),
        price: Number(form.price),
        duration: form.duration.trim(), // e.g. "1h", "1d", "30d"
        speed: form.speed.trim(),       // e.g. "2M/1M"
        server: form.server.trim(),
        profile: form.profile.trim(),
        secret: form.secret.trim(),
      };

      const { data } = await api.post("/hotspot-plans", payload, {
        headers: { "Content-Type": "application/json" },
      });

      setMsg(data?.message || "✅ Plan saved");
      setForm({
        name: "",
        price: "",
        duration: "",
        speed: "",
        server: "",
        profile: "",
        secret: "",
      });
      await loadPlans();
    } catch (e) {
      console.error("Add hotspot plan failed:", e?.__debug || e);
      setMsg(`❌ Failed to add plan${e?.message ? `: ${e.message}` : ""}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id) {
    if (!id) return;
    if (!window.confirm("Delete this plan?")) return;

    setBusy(true);
    setMsg("");
    try {
      const { data } = await api.delete(`/hotspot-plans/${id}`);
      setMsg(data?.message || "✅ Plan deleted");
      await loadPlans();
    } catch (e) {
      console.error("Delete hotspot plan failed:", e?.__debug || e);
      setMsg(`❌ Failed to delete plan${e?.message ? `: ${e.message}` : ""}`);
    } finally {
      setBusy(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <span className="close" onClick={onClose}>
          <FaTimes />
        </span>

        <h2>Configure Hotspot Plan</h2>
        {msg && <p className="status-msg">{msg}</p>}

        <form id="hotspotPlanForm" onSubmit={handleSubmit}>
          <fieldset>
            <legend>Plan Details</legend>
            <input
              type="text"
              name="name"
              value={form.name}
              onChange={onChange}
              placeholder="Plan Name"
              required
            />
            <input
              type="number"
              name="price"
              value={form.price}
              onChange={onChange}
              placeholder="Price (KES)"
              min="0"
              step="1"
              required
            />
            <input
              type="text"
              name="duration"
              value={form.duration}
              onChange={onChange}
              placeholder="Duration (e.g., 1h, 1d, 30d)"
              required
            />
            <input
              type="text"
              name="speed"
              value={form.speed}
              onChange={onChange}
              placeholder="Speed (e.g., 2M/1M)"
              required
            />
          </fieldset>

          <fieldset>
            <legend>MikroTik Hotspot Settings</legend>
            <input
              type="text"
              name="server"
              value={form.server}
              onChange={onChange}
              placeholder="Hotspot Server"
              required
            />
            <input
              type="text"
              name="profile"
              value={form.profile}
              onChange={onChange}
              placeholder="Hotspot Profile"
              required
            />
            <input
              type="text"
              name="secret"
              value={form.secret}
              onChange={onChange}
              placeholder="Shared Secret (optional)"
            />
          </fieldset>

          <button type="submit" disabled={busy}>
            <MdAdd className="inline-icon" /> {busy ? "Saving…" : "Save Plan"}
          </button>
        </form>

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
              {Array.isArray(plans) && plans.length > 0 ? (
                plans.map((plan) => (
                  <tr key={plan._id}>
                    <td>{plan.name}</td>
                    <td>{plan.price}</td>
                    <td>{plan.duration}</td>
                    <td>{plan.speed}</td>
                    <td>{plan.server}</td>
                    <td>{plan.profile}</td>
                    <td>
                      <button className="action-btn edit" title="Edit (not implemented)">
                        <AiOutlineEdit />
                      </button>
                      <button
                        className="action-btn delete"
                        onClick={() => handleDelete(plan._id)}
                        title="Delete"
                      >
                        <RiDeleteBinLine />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="7" style={{ textAlign: "center" }}>
                    No plans found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
