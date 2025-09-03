// src/components/CustomersModal.jsx
import React, { useEffect, useMemo, useState } from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd } from "react-icons/md";
import { AiOutlineEdit } from "react-icons/ai";
import { RiDeleteBinLine } from "react-icons/ri";
import "./CustomersModal.css";
import { api } from "../lib/apiClient";

/** ---------- utils ---------- */

function normalizeProfilesShape(input) {
  // Accept a wide array of shapes and return [{ name, rateLimit, id }]
  if (!input) return [];
  let arr = input;

  // If server wrapped it
  if (Array.isArray(input.profiles)) arr = input.profiles;
  if (Array.isArray(input.data?.profiles)) arr = input.data.profiles;

  if (!Array.isArray(arr)) arr = [];

  return arr
    .map((p, idx) => {
      if (p == null) return null;

      // string -> {name}
      if (typeof p === "string") return { name: p, rateLimit: "", id: String(idx) };

      // MikroTik API adapters often return fields like ".id" or "name"
      const name =
        p.name ??
        p.profile ??
        p.profileName ??
        p.title ??
        p.id ??
        p._id ??
        p[".id"] ??
        `profile_${idx}`;

      const id = p.id ?? p._id ?? p[".id"] ?? String(idx);
      const rateLimit = p.rateLimit ?? p["rate-limit"] ?? p.speed ?? p.bandwidth ?? "";

      return { name: String(name), id: String(id), rateLimit: rateLimit ? String(rateLimit) : "" };
    })
    .filter(Boolean);
}

function getProfileValueForSelect(p) {
  // We'll use name as the canonical value; if missing, fallback to id.
  return p?.name || p?.id || "";
}

function CustomerForm({ type, plans, pppoeProfiles, customer, onSubmit, loading }) {
  const [name, setName] = useState(customer?.name || "");
  const [email, setEmail] = useState(customer?.email || "");
  const [phone, setPhone] = useState(customer?.phone || "");
  const [address, setAddress] = useState(customer?.address || "");
  const [plan, setPlan] = useState(customer?.plan?._id || "");
  const [networkType, setNetworkType] = useState(customer?.connectionType || "pppoe");

  // Normalize the selected profile string across shapes:
  const initialSelected =
    customer?.pppoeConfig?.profile ||
    customer?.pppoeConfig?.name ||
    customer?.pppoeConfig?.id ||
    "";
  const [selectedProfile, setSelectedProfile] = useState(initialSelected);

  const [staticConfig, setStaticConfig] = useState(
    customer?.staticConfig || { ip: "", gateway: "", dns: "" }
  );

  // Always select first profile if PPPoE + nothing selected
  useEffect(() => {
    if (networkType !== "pppoe") return;
    if (!pppoeProfiles.length) return;
    if (selectedProfile) return;

    const first = pppoeProfiles[0];
    setSelectedProfile(getProfileValueForSelect(first));
  }, [pppoeProfiles, networkType, selectedProfile]);

  const handleSubmit = (e) => {
    e.preventDefault();

    // Translate selectedProfile (which may be name or id) back into the object if needed
    const chosen = pppoeProfiles.find(
      (p) =>
        getProfileValueForSelect(p) === selectedProfile ||
        p?.name === selectedProfile ||
        p?.id === selectedProfile
    );

    const profileName = chosen?.name || selectedProfile || "";
    const body = {
      name,
      email,
      phone,
      address,
      plan,
      connectionType: networkType,
      ...(networkType === "pppoe"
        ? { pppoeConfig: { profile: profileName } }
        : { staticConfig }),
    };

    onSubmit(body);

    if (type === "Add") {
      setName("");
      setEmail("");
      setPhone("");
      setAddress("");
      setPlan("");
      setNetworkType("pppoe");
      setSelectedProfile("");
      setStaticConfig({ ip: "", gateway: "", dns: "" });
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full Name" required />
      <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email" required />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone Number" required />
      <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" required />

      <select value={plan} onChange={(e) => setPlan(e.target.value)} required>
        <option value="">Select Plan</option>
        {plans.map((p) => (
          <option key={p._id} value={p._id}>
            {p.name} - {p.speed}Mbps - {p.price} KES
          </option>
        ))}
      </select>

      {type !== "Remove" && (
        <>
          <select value={networkType} onChange={(e) => setNetworkType(e.target.value)}>
            <option value="pppoe">PPPoE</option>
            <option value="static">Static</option>
          </select>

          {networkType === "pppoe" && (
            <select
              value={selectedProfile}
              onChange={(e) => setSelectedProfile(e.target.value)}
              required
            >
              <option value="">Select PPPoE Profile</option>
              {pppoeProfiles.map((p, i) => (
                <option key={p.id || p.name || i} value={getProfileValueForSelect(p)}>
                  {p.name || p.id} {p.rateLimit ? `(${p.rateLimit})` : ""}
                </option>
              ))}
            </select>
          )}

          {networkType === "static" && (
            <div className="static-config">
              <input
                value={staticConfig.ip}
                onChange={(e) => setStaticConfig({ ...staticConfig, ip: e.target.value })}
                placeholder="IP Address"
                required
              />
              <input
                value={staticConfig.gateway}
                onChange={(e) => setStaticConfig({ ...staticConfig, gateway: e.target.value })}
                placeholder="Gateway"
                required
              />
              <input
                value={staticConfig.dns}
                onChange={(e) => setStaticConfig({ ...staticConfig, dns: e.target.value })}
                placeholder="DNS"
                required
              />
            </div>
          )}
        </>
      )}

      <button type="submit" disabled={loading}>
        {type === "Add" ? (
          <>
            <MdAdd className="inline-icon" /> Add Customer
          </>
        ) : type === "Update" ? (
          <>
            <AiOutlineEdit className="inline-icon" /> Update Customer
          </>
        ) : (
          <>
            <RiDeleteBinLine className="inline-icon" /> Remove Customer
          </>
        )}
      </button>
    </form>
  );
}

export default function CustomersModal({ isOpen, onClose }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [customers, setCustomers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [pppoeProfiles, setPppoeProfiles] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [activeTab, setActiveTab] = useState("Add");

  const showError = (msg, e) => {
    console.error(msg, e?.__debug || e);
    const detail =
      e?.response?.data?.message ||
      e?.message ||
      (typeof e === "string" ? e : "");
    setMessage(`❌ ${msg}${detail ? `: ${detail}` : ""}`);
  };

  const loadCustomers = async () => {
    try {
      const { data } = await api.get("/customers");
      setCustomers(Array.isArray(data) ? data : []);
    } catch (e) {
      showError("Failed to load customers", e);
    }
  };

  const loadPlans = async () => {
    try {
      const { data } = await api.get("/plans");
      setPlans(Array.isArray(data) ? data : []);
    } catch (e) {
      showError("Failed to load plans", e);
    }
  };

  const loadProfiles = async () => {
    try {
      // 1) Preferred route
      const r1 = await api.get("/customers/profiles");
      let normalized = normalizeProfilesShape(r1.data);
      // 2) Fallback route(s)
      if (!normalized.length) {
        const r2 = await api.get("/pppoe/profiles"); // if exposed
        normalized = normalizeProfilesShape(r2.data);
      }
      if (!normalized.length) {
        const r3 = await api.get("/mikrotik/pppoe-profiles"); // another common mount
        normalized = normalizeProfilesShape(r3.data);
      }
      setPppoeProfiles(normalized);
      if (!normalized.length) {
        setMessage("⚠️ No PPPoE profiles found.");
      }
    } catch (e) {
      showError("Failed to load PPPoE profiles", e);
      setPppoeProfiles([]);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setMessage("");
    Promise.all([loadCustomers(), loadPlans(), loadProfiles()]).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const sendRequest = async (url, method, body, successMsg) => {
    setLoading(true);
    setMessage("");
    try {
      const { data } = await api.request({
        url,
        method,
        data: body || undefined,
        headers: { "Content-Type": "application/json" },
      });
      setMessage(data?.message || successMsg || "✅ Success");
      await loadCustomers();
    } catch (e) {
      showError("Error connecting to server", e);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content customers-modal">
        <span className="close" onClick={onClose}>
          <FaTimes />
        </span>
        <h2>Manage Customers</h2>
        {message && <p className="status-msg">{message}</p>}

        <div className="tabs">
          {["Add", "Update", "Remove"].map((tab) => (
            <button
              key={tab}
              className={`tab-btn ${activeTab === tab ? "active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="tab-content">
          {activeTab === "Add" && (
            <CustomerForm
              type="Add"
              plans={plans}
              pppoeProfiles={pppoeProfiles}
              onSubmit={(body) =>
                sendRequest("/customers", "POST", body, "✅ Customer added")
              }
              loading={loading}
            />
          )}

          {activeTab === "Update" && (
            <>
              <select
                onChange={(e) =>
                  setSelectedCustomer(customers.find((c) => c._id === e.target.value) || null)
                }
              >
                <option value="">Select Customer</option>
                {customers.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {selectedCustomer && (
                <CustomerForm
                  type="Update"
                  customer={selectedCustomer}
                  plans={plans}
                  pppoeProfiles={pppoeProfiles}
                  onSubmit={(body) =>
                    sendRequest(
                      `/customers/${selectedCustomer._id}`,
                      "PUT",
                      body,
                      "✅ Customer updated"
                    )
                  }
                  loading={loading}
                />
              )}
            </>
          )}

          {activeTab === "Remove" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!selectedCustomer) return;
                sendRequest(
                  `/customers/${selectedCustomer._id}`,
                  "DELETE",
                  null,
                  "✅ Customer removed"
                );
              }}
            >
              <select
                onChange={(e) =>
                  setSelectedCustomer(customers.find((c) => c._id === e.target.value) || null)
                }
              >
                <option value="">Select Customer</option>
                {customers.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button type="submit" disabled={loading || !selectedCustomer}>
                <RiDeleteBinLine className="inline-icon" /> Remove Customer
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
