import React, { useState, useEffect } from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd } from "react-icons/md";
import { AiOutlineEdit } from "react-icons/ai";
import { RiDeleteBinLine } from "react-icons/ri";
import "./PppoeModal.css";

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

  const [loading, setLoading] = useState(false);

  // Load profiles from backend
  useEffect(() => {
    if (isOpen) {
      setLoadingProfiles(true);
      fetch(`${API_BASE}/profiles`)
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.message || "Failed to fetch profiles");
          setProfiles(data.profiles || []);
          setProfile(data.profiles?.[0]?.name || "");
        })
        .catch((err) => {
          console.error("Error fetching profiles:", err);
          setProfiles([]);
        })
        .finally(() => setLoadingProfiles(false));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Helper: fetch with error handling
  const apiRequest = async (url, options) => {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Request failed");
    return data;
  };

  // Add PPPoE user
  const handleAddUser = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await apiRequest(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, profile }),
      });
      alert(data.message);
      setUsername("");
      setPassword("");
    } catch (err) {
      alert("Error: " + err.message);
      console.error("Add user error:", err);
    } finally {
      setLoading(false);
    }
  };

  // Update PPPoE user password
  const handleUpdateUser = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await apiRequest(`${API_BASE}/update/${updateUser}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      alert(data.message);
      setUpdateUser("");
      setNewPassword("");
    } catch (err) {
      alert("Error: " + err.message);
      console.error("Update user error:", err);
    } finally {
      setLoading(false);
    }
  };

  // Remove PPPoE user
  const handleRemoveUser = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await apiRequest(`${API_BASE}/remove/${removeUser}`, {
        method: "DELETE",
      });
      alert(data.message);
      setRemoveUser("");
    } catch (err) {
      alert("Error: " + err.message);
      console.error("Remove user error:", err);
    } finally {
      setLoading(false);
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
            disabled={loadingProfiles}
          >
            {loadingProfiles ? (
              <option>Loading profiles...</option>
            ) : profiles.length === 0 ? (
              <option>No profiles available</option>
            ) : (
              profiles.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name} - {p.price} KES ({p.duration})
                </option>
              ))
            )}
          </select>
          <button type="submit" disabled={loading}>
            <MdAdd className="inline-icon" /> {loading ? "Adding..." : "Add User"}
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
          <button type="submit" disabled={loading}>
            <AiOutlineEdit className="inline-icon" />{" "}
            {loading ? "Updating..." : "Update Password"}
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
          <button type="submit" className="remove-btn" disabled={loading}>
            <RiDeleteBinLine className="inline-icon" />{" "}
            {loading ? "Removing..." : "Remove User"}
          </button>
        </form>
      </div>
    </div>
  );
}
