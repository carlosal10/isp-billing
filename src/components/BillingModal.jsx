import { Field } from "./ui/Field";
import React, { useRef } from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd } from "react-icons/md";
import { AiOutlineEdit } from "react-icons/ai";
import { RiDeleteBinLine } from "react-icons/ri";


export default function BillingModal({ isOpen, onClose }) {




  if (!isOpen) return null;



  return (
    <div className="modal-overlay">
      <div  className="modal-content dialog-surface">
        <span className="close" onClick={onClose}>
          <FaTimes />
        </span>

        <h2>Manage Billing</h2>

        {/* Add Bill */}
        <form id="addBillForm">
          <Field label="Customer ID / Username"><input type="text" placeholder="Customer ID / Username" required /></Field>
          <Field label="Amount (KES)"><input type="number" placeholder="Amount (KES)" required /></Field>
          <Field label="Date"><input type="date" required /></Field>
          <button type="submit">
            <MdAdd className="inline-icon" /> Add Bill
          </button>
        </form>

        {/* Update Bill */}
        <form id="updateBillForm">
          <Field label="Bill ID"><input type="text" placeholder="Bill ID" required /></Field>
          <Field label="New Amount (KES)"><input type="number" placeholder="New Amount (KES)" /></Field>
          <Field label="Select Payment Status"><select>
            <option value="">Select Payment Status</option>
            <option value="paid">Paid</option>
            <option value="pending">Pending</option>
          </select></Field>
          <button type="submit">
            <AiOutlineEdit className="inline-icon" /> Update Bill
          </button>
        </form>

        {/* Remove Bill */}
        <form id="removeBillForm">
          <Field label="Bill ID"><input type="text" placeholder="Bill ID" required /></Field>
          <button type="submit" className="remove-btn">
            <RiDeleteBinLine className="inline-icon" /> Remove Bill
          </button>
        </form>
      </div>
    </div>
  );
}
