import React, { useState, useEffect } from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd } from "react-icons/md";
import { AiOutlineEdit } from "react-icons/ai";
import { RiDeleteBinLine } from "react-icons/ri";
import "./CustomersModal.css";

export default function CustomersModal({ isOpen, onClose }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [customers, setCustomers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  const [networkType, setNetworkType] = useState("pppoe");
  const [pppoeProfiles, setPppoeProfiles] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [staticConfig, setStaticConfig] = useState({ ip: "", gateway: "", dns: "" });

  // Load customers + plans
  useEffect(() => {
    fetch("https://isp-billing-uq58.onrender.com/api/customers")
      .then(res => res.json())
      .then(data => setCustomers(data))
      .catch(() => setMessage("❌ Failed to load customers"));

    fetch("https://isp-billing-uq58.onrender.com/api/plans")
      .then(res => res.json())
      .then(data => setPlans(data))
      .catch(() => setMessage("❌ Failed to load plans"));
  }, []);

  // Load PPPoE profiles dynamically
useEffect(() => {
  if (networkType === "pppoe") {
    fetch("https://isp-billing-uq58.onrender.com/api/customers/pppoe/profiles")
      .then(res => res.json())
      .then(data => setPppoeProfiles(data.profiles || []))
      .catch(() => setMessage("❌ Failed to load PPPoE profiles"));
  }
}, [networkType]);


  if (!isOpen) return null;

  const sendRequest = async (url, method, body, successMsg) => {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : null,
      });
      const data = await res.json();
      setMessage(data.message || successMsg || "✅ Success");

      // Refresh customers after add/update/delete
      fetch("https://isp-billing-uq58.onrender.com/api/customers")
        .then(res => res.json())
        .then(data => setCustomers(data));
    } catch (err) {
      setMessage("❌ Error connecting to server");
    } finally {
      setLoading(false);
    }
    
  };

  

  return (
    <div className="modal-overlay">
      <div className="modal-content customers-modal">
        <span className="close" onClick={onClose}>
          <FaTimes />
        </span>

        <h2>Manage Customers</h2>
        {message && <p className="status-msg">{message}</p>}

        {/* === Add Customer === */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const body = {
              name: e.target.name.value,
              email: e.target.email.value,
              phone: e.target.phone.value,
              address: e.target.address.value,
              plan: e.target.plan.value,
              networkType,
              ...(networkType === "pppoe"
                ? { pppoeProfile: selectedProfile }
                : { staticConfig }),
            };
            sendRequest(
              "https://isp-billing-uq58.onrender.com/api/customers",
              "POST",
              body,
              "✅ Customer added"
            );
            e.target.reset();
          }}
        >
          <h3>Add Customer</h3>
          <input name="name" type="text" placeholder="Full Name" required />
          <input name="email" type="email" placeholder="Email" required />
          <input name="phone" type="tel" placeholder="Phone Number" required />
          <input name="address" type="text" placeholder="Address" required />

          <select name="plan" required>
            <option value="">Select Plan</option>
            {plans.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name} - {p.speed}Mbps - {p.price} KES
              </option>
            ))}
          </select>

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
              {pppoeProfiles.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name} {p.rateLimit ? `(${p.rateLimit})` : ""}
                </option>
              ))}
            </select>
          )}


          {networkType === "static" && (
            <div className="static-config">
              <input
                type="text"
                placeholder="IP Address"
                value={staticConfig.ip}
                onChange={(e) =>
                  setStaticConfig({ ...staticConfig, ip: e.target.value })
                }
                required
              />
              <input
                type="text"
                placeholder="Gateway"
                value={staticConfig.gateway}
                onChange={(e) =>
                  setStaticConfig({ ...staticConfig, gateway: e.target.value })
                }
                required
              />
              <input
                type="text"
                placeholder="DNS"
                value={staticConfig.dns}
                onChange={(e) =>
                  setStaticConfig({ ...staticConfig, dns: e.target.value })
                }
                required
              />
            </div>
          )}

          <button type="submit" disabled={loading}>
            <MdAdd className="inline-icon" /> Add Customer
          </button>
        </form>

        {/* === Update Customer === */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!selectedCustomer) return;
            const body = {
              name: e.target.name.value,
              email: e.target.email.value,
              phone: e.target.phone.value,
              address: e.target.address.value,
              plan: e.target.plan.value,
              networkType,
              ...(networkType === "pppoe"
                ? { pppoeProfile: selectedProfile }
                : { staticConfig }),
            };
            sendRequest(
              `https://isp-billing-uq58.onrender.com/api/customers/${selectedCustomer._id}`,
              "PUT",
              body,
              "✅ Customer updated"
            );
          }}
        >
          <h3>Update Customer</h3>
          <select
            onChange={(e) => {
              const customer = customers.find(c => c._id === e.target.value);
              setSelectedCustomer(customer);
              if (customer) {
                e.target.form.name.value = customer.name || "";
                e.target.form.email.value = customer.email || "";
                e.target.form.phone.value = customer.phone || "";
                e.target.form.address.value = customer.address || "";
                e.target.form.plan.value = customer.plan?._id || "";
                setNetworkType(customer.networkType || "pppoe");
                setSelectedProfile(customer.pppoeProfile?._id || "");
                setStaticConfig(customer.staticConfig || { ip: "", gateway: "", dns: "" });
              }
            }}
          >
            <option value="">Select  Customer</option>
            {customers.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>

          <input name="name" type="text" placeholder="Full Name" required />
          <input name="email" type="email" placeholder="Email" required />
          <input name="phone" type="tel" placeholder="Phone Number" required />
          <input name="address" type="text" placeholder="Address" required />

          <select name="plan" required>
            <option value="">Select Plan</option>
            {plans.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name} - {p.speed}Mbps - {p.price} KES
              </option>
            ))}
          </select>

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
              {pppoeProfiles.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name} ({p.speed} Mbps)
                </option>
              ))}
            </select>
          )}

          {networkType === "static" && (
            <div className="static-config">
              <input
                type="text"
                placeholder="IP Address"
                value={staticConfig.ip}
                onChange={(e) =>
                  setStaticConfig({ ...staticConfig, ip: e.target.value })
                }
                required
              />
              <input
                type="text"
                placeholder="Gateway"
                value={staticConfig.gateway}
                onChange={(e) =>
                  setStaticConfig({ ...staticConfig, gateway: e.target.value })
                }
                required
              />
              <input
                type="text"
                placeholder="DNS"
                value={staticConfig.dns}
                onChange={(e) =>
                  setStaticConfig({ ...staticConfig, dns: e.target.value })
                }
                required
              />
            </div>
          )}

          <button type="submit" disabled={loading}>
            <AiOutlineEdit className="inline-icon" /> Update Customer
          </button>
        </form>

        {/* === Remove Customer === */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!selectedCustomer) return;
            sendRequest(
              `https://isp-billing-uq58.onrender.com/api/customers/${selectedCustomer._id}`,
              "DELETE",
              null,
              "✅ Customer removed"
            );
          }}
        >
          <h3>Remove Customer</h3>
          <select
            onChange={(e) => {
              const customer = customers.find(c => c._id === e.target.value);
              setSelectedCustomer(customer);
            }}
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
      </div>
    </div>
  );
}
