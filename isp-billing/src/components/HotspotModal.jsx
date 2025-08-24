import React from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd } from "react-icons/md";
import { AiOutlineEdit } from "react-icons/ai";
import { RiDeleteBinLine } from "react-icons/ri";

export default function HotspotModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        {/* Close Button */}
        <span className="close" onClick={onClose}>
          <FaTimes />
        </span>

        <h2>Configure Hotspot Plan</h2>

        {/* Hotspot Plan Form */}
        <form id="hotspotPlanForm">
          {/* Plan Details */}
          <fieldset>
            <legend>Plan Details</legend>
            <input type="text" placeholder="Plan Name" required />
            <input type="number" placeholder="Price (KES)" required />
            <input type="text" placeholder="Duration (e.g., 1h, 1d, 30d)" required />
            <input type="text" placeholder="Speed (e.g., 2M/1M)" required />
          </fieldset>

          {/* MikroTik Configuration */}
          <fieldset>
            <legend>MikroTik Hotspot Settings</legend>

            <select required>
              <option value="">Select Hotspot Server</option>
              {/* Dynamic Options later */}
            </select>

            <select required>
              <option value="">Select Hotspot Profile</option>
              {/* Dynamic Options later */}
            </select>

            {/* Loader placeholder */}
            <div id="hotspotLoaders" style={{ display: "none", margin: "10px 0" }}>
              <span>Loading hotspot configurations...</span>
              <div className="spinner"></div>
            </div>

            <input type="text" placeholder="Shared Secret (if any)" />
          </fieldset>

          <button type="submit">
            <MdAdd className="inline-icon" /> Save Plan
          </button>
        </form>

        {/* Table of Hotspot Plans */}
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
              {/* Example row (replace with dynamic rows later) */}
              <tr>
                <td>Daily Plan</td>
                <td>50</td>
                <td>1d</td>
                <td>2M/1M</td>
                <td>Server1</td>
                <td>ProfileA</td>
                <td>
                  <button className="action-btn edit">
                    <AiOutlineEdit />
                  </button>
                  <button className="action-btn delete">
                    <RiDeleteBinLine />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
