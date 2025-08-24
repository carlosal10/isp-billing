import React from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd } from "react-icons/md";
import { AiOutlineEdit } from "react-icons/ai";
import { RiDeleteBinLine } from "react-icons/ri";

export default function BillingModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <span className="close" onClick={onClose}>
          <FaTimes />
        </span>

        <h2>Manage Billing</h2>

        {/* Add Bill */}
        <form id="addBillForm">
          <input type="text" placeholder="Customer ID / Username" required />
          <input type="number" placeholder="Amount (KES)" required />
          <input type="date" required />
          <button type="submit">
            <MdAdd className="inline-icon" /> Add Bill
          </button>
        </form>

        {/* Update Bill */}
        <form id="updateBillForm">
          <input type="text" placeholder="Bill ID" required />
          <input type="number" placeholder="New Amount (KES)" />
          <select>
            <option value="">Select Payment Status</option>
            <option value="paid">Paid</option>
            <option value="pending">Pending</option>
          </select>
          <button type="submit">
            <AiOutlineEdit className="inline-icon" /> Update Bill
          </button>
        </form>

        {/* Remove Bill */}
        <form id="removeBillForm">
          <input type="text" placeholder="Bill ID" required />
          <button type="submit" className="remove-btn">
            <RiDeleteBinLine className="inline-icon" /> Remove Bill
          </button>
        </form>
      </div>
    </div>
  );
}
