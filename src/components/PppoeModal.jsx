// src/components/PppoeModal.jsx
import React, { useEffect, useState, useRef } from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd } from "react-icons/md";
import { AiOutlineEdit } from "react-icons/ai";
import { RiDeleteBinLine } from "react-icons/ri";
import { api } from "../lib/apiClient"; // ✅ use authenticated axios
import "./PppoeModal.css";
import useDragResize from "../hooks/useDragResize";

export default function PppoeModal({ isOpen, onClose }) {
  const [profiles, setProfiles] = useState([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [msg, setMsg] = useState("");

  // add
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [profile, setProfile] = useState("");

  // update
  const [updateUser, setUpdateUser] = useState("");
  const [newPassword, setNewPassword] = useState("");

  // remove
const [removeUser, setRemoveUser] = useState("");

const [loading, setLoading] = useState(false);
  const containerRef = useRef(null);
  const dragHandleRef = useRef(null);
  const { getResizeHandleProps, isDraggingEnabled } = useDragResize({
    isOpen,
    containerRef,
    handleRef: dragHandleRef,
    minWidth: 560,
    minHeight: 520,
    defaultSize: { width: 760, height: 600 },
  });
  const resizeHandles = isDraggingEnabled ? ["n", "s", "e", "w", "ne", "nw", "se", "sw"] : [];

  // Load PPPoE profiles from backend (protected route)
  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    (async () => {
      setLoadingProfiles(true);
      setMsg("");
      try {
        const { data } = await api.get("/pppoe/profiles");
        const list = Array.isArray(data?.profiles) ? data.profiles : [];
        if (!mounted) return;
        setProfiles(list);
        setProfile(list[0]?.name || "");
      } catch (err) {
        console.error("Error fetching profiles:", err);
        setMsg(err?.response?.data?.error || err?.message || "Failed to fetch profiles");
        setProfiles([]);
      } finally {
        if (mounted) setLoadingProfiles(false);
      }
    })();
    return () => { mounted = false; };
  }, [isOpen]);

  if (!isOpen) return null;

  // ---- helpers ----
  const showOk = (t) => setMsg(`✅ ${t}`);
  const showErr = (t) => setMsg(`❌ ${t}`);

  // Add PPPoE user
  const handleAddUser = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMsg("");
    try {
      await api.post("/pppoe", { username, password, profile });
      showOk("User added");
      setUsername("");
      setPassword("");
    } catch (err) {
      console.error("Add user error:", err);
      showErr(err?.response?.data?.error || err?.message || "Add failed");
    } finally {
      setLoading(false);
    }
  };

  // Update PPPoE user password
  const handleUpdateUser = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMsg("");
    try {
      await api.put(`/pppoe/update/${encodeURIComponent(updateUser)}`, {
        password: newPassword,
      });
      showOk("Password updated");
      setUpdateUser("");
      setNewPassword("");
    } catch (err) {
      console.error("Update user error:", err);
      showErr(err?.response?.data?.error || err?.message || "Update failed");
    } finally {
      setLoading(false);
    }
  };

  // Remove PPPoE user
  const handleRemoveUser = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMsg("");
    try {
      await api.delete(`/pppoe/remove/${encodeURIComponent(removeUser)}`);
      showOk("User removed");
      setRemoveUser("");
    } catch (err) {
      console.error("Remove user error:", err);
      showErr(err?.response?.data?.error || err?.message || "Remove failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div ref={containerRef} className="modal-content draggable-modal">
        {isDraggingEnabled && (
          <>
            <div className="modal-drag-bar" ref={dragHandleRef}>Drag</div>
            {resizeHandles.map((dir) => (
              <div
                key={dir}
                className={`modal-resize-handle ${
                  dir.length === 1 ? "edge" : "corner"
                } ${["n", "s"].includes(dir) ? "horizontal" : ""} ${["e", "w"].includes(dir) ? "vertical" : ""} ${dir}`}
                {...getResizeHandleProps(dir)}
              />
            ))}
          </>
        )}
        <span className="close" onClick={onClose} data-modal-no-drag>
          <FaTimes />
        </span>

        <h2>Manage PPPoE Users</h2>
        {msg && <p className="status-msg">{msg}</p>}

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
                <option key={p.id || p.name} value={p.name}>
                  {p.name} {p.rateLimit ? `(${p.rateLimit})` : ""}
                </option>
              ))
            )}
          </select>

          <button type="submit" disabled={loading || loadingProfiles}>
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
