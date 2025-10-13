// src/components/CustomersModal.jsx
import React, { useEffect, useState, useCallback, useRef } from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd } from "react-icons/md";
import { AiOutlineEdit } from "react-icons/ai";
import { RiDeleteBinLine } from "react-icons/ri";
import "./CustomersModal.css";
import { api } from "../lib/apiClient";
import useDragResize from "../hooks/useDragResize";

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
  const [accountNumber, setAccountNumber] = useState(customer?.accountNumber || "");
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
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueOpts, setQueueOpts] = useState([]);
  const [selectedQueueIp, setSelectedQueueIp] = useState("");
  const [useQueueIp, setUseQueueIp] = useState(false);
  const [useArpIp, setUseArpIp] = useState(false);
  const [useRouterAll, setUseRouterAll] = useState(true);
  const [arpLoading, setArpLoading] = useState(false);
  const [arpOpts, setArpOpts] = useState([]);
  const [selectedArpIp, setSelectedArpIp] = useState("");
  const [arpLanOnly, setArpLanOnly] = useState(false);
  const [arpPrivateOnly, setArpPrivateOnly] = useState(false);
  const [arpPermanentOnly, setArpPermanentOnly] = useState(false);
  const [routerAllLoading, setRouterAllLoading] = useState(false);
  const [routerAllOpts, setRouterAllOpts] = useState([]);
  const [selectedRouterAllIp, setSelectedRouterAllIp] = useState("");
  const [trustLists, setTrustLists] = useState(true);

  const [queueTried, setQueueTried] = useState(false);

  const loadQueues = useCallback(async () => {
    try {
      setQueueLoading(true);
      const { data } = await api.get('/queues/simple');
      const list = Array.isArray(data?.queues) ? data.queues : [];
      const seen = new Set();
      const opts = [];
      for (const q of list) {
        const ip = String(q?.ip || '').trim();
        if (!ip || seen.has(ip)) continue;
        seen.add(ip);
        const label = `${ip} ${q.comment ? '— ' + q.comment : q.name ? '— ' + q.name : ''}`;
        opts.push({ ip, label });
      }
      setQueueOpts(opts);
    } catch (e) {
      // ignore
      setQueueOpts([]);
    } finally {
      setQueueLoading(false);
      setQueueTried(true);
    }
  }, []);

  // Auto-load queues when switching to Static
  useEffect(() => {
    if (networkType === 'static' && useQueueIp && !queueLoading && !queueTried && queueOpts.length === 0) {
      loadQueues();
    }
  }, [networkType, useQueueIp, queueLoading, queueTried, queueOpts.length, loadQueues]);

  const loadArps = useCallback(async () => {
    try {
      setArpLoading(true);
      const { data } = await api.get('/arp', { params: { lanOnly: !!arpLanOnly, privateOnly: !!arpPrivateOnly, permanentOnly: !!arpPermanentOnly } });
      const list = Array.isArray(data?.arps) ? data.arps : [];
      const seen = new Set();
      const opts = [];
      for (const a of list) {
        const ip = String(a?.address || '').trim();
        if (!ip || seen.has(ip)) continue;
        seen.add(ip);
        const label = `${ip} ${a.interface ? '— ' + a.interface : ''} ${a.comment ? '— ' + a.comment : ''}`;
        opts.push({ ip, label });
      }
      setArpOpts(opts);
    } catch (e) {
      setArpOpts([]);
    } finally {
      setArpLoading(false);
    }
  }, [arpLanOnly, arpPrivateOnly, arpPermanentOnly]);

  const loadRouterAll = useCallback(async () => {
    try {
      setRouterAllLoading(true);
      const params = {
        include: 'queues,lists,secrets,arp',
        lanOnly: !!arpLanOnly,
        privateOnly: !!arpPrivateOnly,
        permanentOnly: !!arpPermanentOnly,
        trustLists,
      };
      const { data } = await api.get('/static/candidates', { params });
      const list = Array.isArray(data?.candidates) ? data.candidates : [];
      const seen = new Set();
      const opts = [];
      for (const c of list) {
        const ip = String(c?.ip || '').trim();
        if (!ip || seen.has(ip)) continue;
        seen.add(ip);
        const label = `${ip} ${c.label ? '— ' + c.label : ''} ${Array.isArray(c.sources) ? '— ['+c.sources.join(', ')+']' : ''}`;
        opts.push({ ip, label });
      }
      setRouterAllOpts(opts);
    } catch (e) {
      setRouterAllOpts([]);
    } finally {
      setRouterAllLoading(false);
    }
  }, [arpLanOnly, arpPrivateOnly, arpPermanentOnly, trustLists]);

  useEffect(() => {
    if (networkType === 'static' && useArpIp && !arpLoading) {
      loadArps();
    }
  }, [networkType, useArpIp, arpLoading, loadArps]);

  useEffect(() => {
    if (networkType === 'static' && useRouterAll && !routerAllLoading) {
      loadRouterAll();
    }
  }, [networkType, useRouterAll, routerAllLoading, loadRouterAll]);

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
      accountNumber: accountNumber || undefined,
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
      <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="Account Number (optional)" />

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
              <label style={{ display:'inline-flex', alignItems:'center', gap:6, marginBottom: 6 }}>
                <input type="checkbox" checked={useQueueIp} onChange={() => setUseQueueIp(v => !v)} />
                Pick IP from router queues (existing configs)
              </label>
              <label style={{ display:'inline-flex', alignItems:'center', gap:6, marginBottom: 6, marginLeft: 8 }}>
                <input type="checkbox" checked={useArpIp} onChange={() => setUseArpIp(v => !v)} />
                Pick IP from ARP table (LAN)
              </label>
              <label style={{ display:'inline-flex', alignItems:'center', gap:6, marginBottom: 6, marginLeft: 8 }}>
                <input type="checkbox" checked={useRouterAll} onChange={() => setUseRouterAll(v => !v)} />
                Pick IP from router (all sources)
              </label>
              {useQueueIp && (
                <select
                  value={selectedQueueIp}
                  onChange={(e) => {
                    const ip = e.target.value;
                    setSelectedQueueIp(ip);
                    if (ip) setStaticConfig((s) => ({ ...s, ip }));
                  }}
                  disabled={queueLoading}
                >
                  <option value="">
                    {queueLoading ? 'Loading router queues…' : (queueOpts.length ? 'Select IP from queues…' : 'No queue IPs found')}
                  </option>
                  {queueOpts.map((o) => (
                    <option key={o.ip} value={o.ip}>{o.label}</option>
                  ))}
                </select>
              )}
              {useArpIp && (
                <select
                  value={selectedArpIp}
                  onChange={(e) => {
                    const ip = e.target.value;
                    setSelectedArpIp(ip);
                    if (ip) setStaticConfig((s) => ({ ...s, ip }));
                  }}
                  disabled={arpLoading}
                >
                  <option value="">
                    {arpLoading ? 'Loading ARP…' : (arpOpts.length ? 'Select IP from ARP…' : 'No ARP IPs found')}
                  </option>
                  {arpOpts.map((o) => (
                    <option key={o.ip} value={o.ip}>{o.label}</option>
                  ))}
                </select>
              )}
              {useRouterAll && (
                <>
                  <div style={{ display:'flex', gap:12, marginTop:6 }}>
                    <label style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                      <input type="checkbox" checked={arpLanOnly} onChange={() => setArpLanOnly(v => !v)} /> LAN only
                    </label>
                    <label style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                      <input type="checkbox" checked={arpPrivateOnly} onChange={() => setArpPrivateOnly(v => !v)} /> Private only
                    </label>
                    <label style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                      <input type="checkbox" checked={arpPermanentOnly} onChange={() => setArpPermanentOnly(v => !v)} /> Permanent only
                    </label>
                    <label style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                      <input type="checkbox" checked={trustLists} onChange={() => setTrustLists(v => !v)} /> Trust lists
                    </label>
                  </div>
                  <select
                    value={selectedRouterAllIp}
                    onChange={(e) => {
                      const ip = e.target.value;
                      setSelectedRouterAllIp(ip);
                      if (ip) setStaticConfig((s) => ({ ...s, ip }));
                    }}
                    disabled={routerAllLoading}
                  >
                    <option value="">
                      {routerAllLoading ? 'Loading…' : (routerAllOpts.length ? 'Select IP from router…' : 'No IPs found')}
                    </option>
                    {routerAllOpts.map((o) => (
                      <option key={o.ip} value={o.ip}>{o.label}</option>
                    ))}
                  </select>
                </>
              )}
              {useArpIp && (
                <div style={{ display:'flex', gap:12, marginTop:6 }}>
                  <label style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                    <input type="checkbox" checked={arpLanOnly} onChange={() => setArpLanOnly(v => !v)} /> LAN only
                  </label>
                  <label style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                    <input type="checkbox" checked={arpPrivateOnly} onChange={() => setArpPrivateOnly(v => !v)} /> Private only
                  </label>
                  <label style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                    <input type="checkbox" checked={arpPermanentOnly} onChange={() => setArpPermanentOnly(v => !v)} /> Permanent only
                  </label>
                </div>
              )}
              <input
                value={staticConfig.ip}
                onChange={(e) => setStaticConfig({ ...staticConfig, ip: e.target.value })}
                placeholder="IP Address (or pick from list)"
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

  // Import tab state
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState([]); // [{accountNumber, ip, rateLimit, source, comment}]
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [importing, setImporting] = useState(false);
  const [importPlan, setImportPlan] = useState("");
  const [autoAcc, setAutoAcc] = useState(true);
  const [trustLists, setTrustLists] = useState(true);

  const containerRef = useRef(null);
  const dragHandleRef = useRef(null);
  const { getResizeHandleProps, isDraggingEnabled } = useDragResize({
    isOpen,
    containerRef,
    handleRef: dragHandleRef,
    minWidth: 780,
    minHeight: 560,
    defaultSize: { width: 1024, height: 720 },
  });
  const resizeHandles = isDraggingEnabled ? ["n", "s", "e", "w", "ne", "nw", "se", "sw"] : [];

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
      <div ref={containerRef} className="modal-content customers-modal draggable-modal">
        {isDraggingEnabled && (
          <>
            <div className="modal-drag-bar" ref={dragHandleRef}>
              Drag
            </div>
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
        <h2>Manage Customers</h2>
        {message && <p className="status-msg">{message}</p>}

        <div className="tabs">
          {["Add", "Update", "Remove", "Import"].map((tab) => (
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

          {activeTab === "Import" && (
            <div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                <button
                  onClick={async () => {
                    setDetecting(true);
                    try {
                      const { data } = await api.get(`/customers/detect-static${trustLists ? '?trustLists=true' : ''}`);
                      const list = Array.isArray(data?.candidates) ? data.candidates : [];
                      setDetected(list);
                      setSelectedKeys(new Set());
                      setMessage(`${list.length} candidate(s) detected`);
                    } catch (e) {
                      console.error(e);
                      setMessage("Failed to detect static clients");
                    } finally {
                      setDetecting(false);
                    }
                  }}
                  disabled={detecting}
                >
                  {detecting ? "Detecting…" : "Detect Static Clients"}
                </button>

                <span style={{ marginLeft: 8, opacity: .8 }}>Assign Plan to imported:</span>
                <select value={importPlan} onChange={(e) => setImportPlan(e.target.value)}>
                  <option value="">No plan</option>
                  {plans.map((p) => (
                    <option key={p._id} value={p._id}>{p.name} {p.speed ? `(${p.speed})` : ""}</option>
                  ))}
                </select>
                <label style={{ marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={trustLists} onChange={() => setTrustLists(v => !v)} /> Trust address-lists
                </label>
                <label style={{ marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={autoAcc} onChange={() => setAutoAcc(v => !v)} /> Auto-generate account numbers
                </label>
              </div>

              {detected.length > 0 ? (
                <div style={{ maxHeight: 260, overflow: "auto", border: "1px solid #e6e9f1", borderRadius: 8 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", padding: 8 }}>
                          <input
                            type="checkbox"
                            checked={selectedKeys.size === detected.length && detected.length > 0}
                            onChange={(e) => {
                              if (e.target.checked) setSelectedKeys(new Set(detected.map((_, i) => String(i))));
                              else setSelectedKeys(new Set());
                            }}
                          />
                        </th>
                        <th style={{ textAlign: "left", padding: 8 }}>Account</th>
                        <th style={{ textAlign: "left", padding: 8 }}>IP</th>
                        <th style={{ textAlign: "left", padding: 8 }}>Rate</th>
                        <th style={{ textAlign: "left", padding: 8 }}>Source</th>
                        <th style={{ textAlign: "left", padding: 8 }}>Comment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detected.map((row, idx) => {
                        const key = String(idx);
                        const checked = selectedKeys.has(key);
                        return (
                          <tr key={key} style={{ borderTop: "1px solid #eef1f6" }}>
                            <td style={{ padding: 8 }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const next = new Set(selectedKeys);
                                  if (e.target.checked) next.add(key);
                                  else next.delete(key);
                                  setSelectedKeys(next);
                                }}
                              />
                            </td>
                            <td style={{ padding: 8 }}>{row.accountNumber || <em style={{ opacity: .6 }}>none</em>}</td>
                            <td style={{ padding: 8 }}>{row.ip}</td>
                            <td style={{ padding: 8 }}>{row.rateLimit || ''}</td>
                            <td style={{ padding: 8, opacity: .8 }}>{row.source}</td>
                            <td style={{ padding: 8, opacity: .8 }}>{row.comment || ''}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ opacity: .7 }}>No candidates yet. Click Detect to fetch from MikroTik.</p>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                <button
                  onClick={async () => {
                    const items = Array.from(selectedKeys).map((k) => detected[Number(k)]).filter(Boolean);
                    if (!items.length) {
                      setMessage("Select at least one row to import");
                      return;
                    }
                    setImporting(true);
                    try {
                      const payload = { 
                        autoAccount: !!autoAcc,
                        items: items.map((it) => ({
                          ...(autoAcc ? {} : { accountNumber: it.accountNumber || it.ip.replace(/\./g, '-') }),
                          ip: it.ip,
                          comment: it.comment || '',
                          planId: importPlan || undefined,
                        })) 
                      };
                      const { data } = await api.post('/customers/import-static', payload, { timeout: 60000 });
                      const okCount = Array.isArray(data?.results) ? data.results.filter((r) => r.ok).length : 0;
                      setMessage(`Imported ${okCount} / ${items.length}`);
                      await loadCustomers();
                    } catch (e) {
                      console.error(e);
                      setMessage("Import failed");
                    } finally {
                      setImporting(false);
                    }
                  }}
                  disabled={importing || selectedKeys.size === 0}
                >
                  {importing ? "Importing…" : `Import Selected (${selectedKeys.size})`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
