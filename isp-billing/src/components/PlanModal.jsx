import React from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd } from "react-icons/md";
import { AiOutlineEdit } from "react-icons/ai";
import { RiDeleteBinLine } from "react-icons/ri";

export default function PlanModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <span className="close" onClick={onClose}>
          <FaTimes />
        </span>

        <h2>Manage Plans</h2>

        {/* Add Plan */}
        <form id="addPlanForm">
          <input type="text" placeholder="Plan Name" required />
          <input type="number" placeholder="Speed (Mbps)" required />
          <input type="number" placeholder="Price (KES)" required />
          <button type="submit">
            <MdAdd className="inline-icon" /> Add Plan
          </button>
        </form>

        {/* Update Plan */}
        <form id="updatePlanForm">
          <input type="text" placeholder="Existing Plan Name" required />
          <input type="number" placeholder="New Speed (Mbps)" />
          <input type="number" placeholder="New Price (KES)" />
          <button type="submit">
            <AiOutlineEdit className="inline-icon" /> Update Plan
          </button>
        </form>

        {/* Remove Plan */}
        <form id="removePlanForm">
          <input type="text" placeholder="Plan Name" required />
          <button type="submit" className="remove-btn">
            <RiDeleteBinLine className="inline-icon" /> Remove Plan
          </button>
        </form>
      </div>
    </div>
  );
}
