import React, { useState, useEffect } from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd } from "react-icons/md";
import { AiOutlineEdit } from "react-icons/ai";
import { RiDeleteBinLine } from "react-icons/ri";
import './PppoeModal.css';

const API_BASE = "https://isp-billing-uq58.onrender.com/api/pppoe";

export default function PppoeModal({ isOpen, onClose }) {
  const [profiles, setProfiles] = useState([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [profile, setProfile] = useState("");

  const [updateUser, setUpdateUser] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [removeUser, setRemoveUser] = useState("");

  // Load profiles from backend
  useEffect(() => {
    if (isOpen) {
      fetch(`${API_BASE}/profiles`)
        .then(res => res.json())
        .then(data => {
          if (data.profiles) {
            setProfiles(data.profiles);
            setProfile(data.profiles[0]?.name || "");
          }
          setLoadingProfiles(false);
        })
        .catch(err => {
          console.error("Error fetching profiles:", err);
          setLoadingProfiles(false);
        });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Add PPPoE user
  const handleAddUser = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, profile }),
      });
      const data = await res.json();
      alert(data.message);
    } catch (err) {
      console.error("Add user error:", err);
    }
  };

  // Update PPPoE user password
  const handleUpdateUser = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/update/${updateUser}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      const data = await res.json();
      alert(data.message);
    } catch (err) {
      console.error("Update user error:", err);
    }
  };

  // Remove PPPoE user
  const handleRemoveUser = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/remove/${removeUser}`, {
        method: "DELETE",
      });
      const data = await res.json();
      alert(data.message);
    } catch (err) {
      console.error("Remove user error:", err);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <span className="close" onClick={onClose}>
          <FaTimes />
        </span>

        <h2>Manage PPPoE Users</h2>

        {/* Add User */}
        <form id="addUserForm" onSubmit={handleAddUser}>
          <input
            type="text"
            placeholder="Username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            type="password"
            placeholder="Password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <select
            required
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
          >
            {loadingProfiles ? (
              <option>Loading profiles...</option>
            ) : (
              profiles.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name} - {p.price} KES ({p.duration})
                </option>
              ))
            )}
          </select>
          <button type="submit">
            <MdAdd className="inline-icon" /> Add User
          </button>
        </form>

        {/* Update User */}
        <form id="updateUserForm" onSubmit={handleUpdateUser}>
          <input
            type="text"
            placeholder="Username"
            required
            value={updateUser}
            onChange={(e) => setUpdateUser(e.target.value)}
          />
          <input
            type="password"
            placeholder="New Password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <button type="submit">
            <AiOutlineEdit className="inline-icon" /> Update Password
          </button>
        </form>

        {/* Remove User */}
        <form id="removeUserForm" onSubmit={handleRemoveUser}>
          <input
            type="text"
            placeholder="Username"
            required
            value={removeUser}
            onChange={(e) => setRemoveUser(e.target.value)}
          />
          <button type="submit" className="remove-btn">
            <RiDeleteBinLine className="inline-icon" /> Remove User
          </button>
        </form>
      </div>
    </div>
  );
}
