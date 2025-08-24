import React from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd } from "react-icons/md";
import { AiOutlineEdit } from "react-icons/ai";
import { RiDeleteBinLine } from "react-icons/ri";

export default function PppoeModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <span className="close" onClick={onClose}>
          <FaTimes />
        </span>

        <h2>Manage PPPoE Users</h2>

        {/* Add User */}
        <form id="addUserForm">
          <input type="text" placeholder="Username" required />
          <input type="password" placeholder="Password" required />
          <select required>
            <option value="">Loading profiles...</option>
          </select>
          <button type="submit">
            <MdAdd className="inline-icon" /> Add User
          </button>
        </form>

        {/* Update User */}
        <form id="updateUserForm">
          <input type="text" placeholder="Username" required />
          <input type="password" placeholder="New Password" required />
          <button type="submit">
            <AiOutlineEdit className="inline-icon" /> Update Password
          </button>
        </form>

        {/* Remove User */}
        <form id="removeUserForm">
          <input type="text" placeholder="Username" required />
          <button type="submit" className="remove-btn">
            <RiDeleteBinLine className="inline-icon" /> Remove User
          </button>
        </form>
      </div>
    </div>
  );
}
