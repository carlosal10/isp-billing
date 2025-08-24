import React from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd } from "react-icons/md";
import { AiOutlineEdit } from "react-icons/ai";
import { RiDeleteBinLine } from "react-icons/ri";
import { BiCreditCard } from "react-icons/bi";

export default function PaymentsModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <span className="close" onClick={onClose}>
          <FaTimes />
        </span>

        <h2>Manage Payments</h2>

        {/* Record Payment */}
        <form id="addPaymentForm">
          <input type="text" placeholder="Customer ID / Username" required />
          <input type="number" placeholder="Amount (KES)" required />
          <select required>
            <option value="">Select Payment Method</option>
            <option value="mpesa">M-Pesa</option>
            <option value="bank">Bank Transfer</option>
            <option value="cash">Cash</option>
            <option value="card">Credit/Debit Card</option>
          </select>
          <button type="submit">
            <MdAdd className="inline-icon" /> Record Payment
          </button>
        </form>

        {/* Update Payment */}
        <form id="updatePaymentForm">
          <input type="text" placeholder="Payment ID" required />
          <input type="number" placeholder="New Amount (KES)" />
          <select>
            <option value="">Update Method</option>
            <option value="mpesa">M-Pesa</option>
            <option value="bank">Bank Transfer</option>
            <option value="cash">Cash</option>
            <option value="card">Credit/Debit Card</option>
          </select>
          <select>
            <option value="">Update Status</option>
            <option value="confirmed">Confirmed</option>
            <option value="pending">Pending</option>
          </select>
          <button type="submit">
            <AiOutlineEdit className="inline-icon" /> Update Payment
          </button>
        </form>

        {/* Delete Payment */}
        <form id="removePaymentForm">
          <input type="text" placeholder="Payment ID" required />
          <button type="submit" className="remove-btn">
            <RiDeleteBinLine className="inline-icon" /> Delete Payment
          </button>
        </form>
      </div>
    </div>
  );
}
