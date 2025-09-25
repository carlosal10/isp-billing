// src/components/CustomersBrowserModal.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Modal } from "./ui/Modal";
import { api } from "../lib/apiClient";
import { exportRows } from "../lib/exporters"; // <-- XLSX (fallback CSV)

function resolveCreatedAt(doc = {}) {
  if (doc?.createdAt) {
    const dt = new Date(doc.createdAt);
    if (Number.isFinite(dt.getTime())) return dt;
  }
  const rawId = doc?._id ? String(doc._id) : "";
  if (rawId.length === 24) {
    const ts = parseInt(rawId.slice(0, 8), 16);
    if (Number.isFinite(ts)) return new Date(ts * 1000);
  }
  return null;
}

export default function CustomersBrowserModal({ open, onClose, onSelect }) {
  const [tab, setTab] = useState("all"); // "all" | "disabled"
  const [all, setAll] = useState([]);
  const [disabled, setDisabled] = useState({ pppoe: [], static: [] });
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const formatCreated = (record) => {
    const dt = resolveCreatedAt(record);
    return dt ? dt.toLocaleString() : "-";
  };

  // -------- Export mapping (current view only) --------
  const mapAllRow = (c) => ({
    "Account #": c.accountNumber ?? "-",
    "Name": c.name ?? "-",
    "Phone": c.phone ?? "-",
    "Email": c.email ?? "-",
    "Address": c.address ?? "-",
    "Plan": c?.plan?.name ?? "-",
    "Created": formatCreated(c),
  });

  const mapDisabledRow = (r) => ({
    "Type": r.kind ?? "-",
    "Account #": r.accountNumber ?? "-",
    "Name": r.customer?.name ?? "-",
    "Phone": r.customer?.phone ?? "-",
    "Email": r.customer?.email ?? "-",
    "Address": r.customer?.address ?? "-",
    "Created": formatCreated(r.customer ?? {}),
  });

  const getCurrentRowsAndHeaders = () => {
    const date = new Date().toISOString().slice(0, 10);
    if (tab === "all") {
      const rows = filteredAll.map(mapAllRow);
      const headers = ["Account #", "Name", "Phone", "Email", "Address", "Plan", "Created"];
      return { rows, headers, filename: `customers-all-${date}`, sheetName: "All" };
    } else {
      const rows = disabledCombined.map(mapDisabledRow);
      const headers = ["Type", "Account #", "Name", "Phone", "Email", "Address", "Created"];
      return { rows, headers, filename: `customers-disabled-${date}`, sheetName: "Disabled" };
    }
  };
  // ---------------------------------------------------

  useEffect(() => {
    if (!open) return;
    setError(null);
    setQ("");
    setTab("all");
    setAll([]);
    setDisabled({ pppoe: [], static: [] });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (tab === "all") {
          const { data } = await api.get("/customers");
          if (!cancelled) setAll(Array.isArray(data) ? data : []);
        } else {
          const { data } = await api.get("/customers/disabled");
          if (!cancelled) setDisabled({ pppoe: data?.pppoe || [], static: data?.static || [] });
        }
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [open, tab]);

  const filteredAll = useMemo(() => {
    const s = (q || "").toLowerCase().trim();
    if (!s) return all;
    return all.filter((c) =>
      [c.name, c.accountNumber, c.phone, c.email, c.address]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s))
    );
  }, [all, q]);

  const disabledCombined = useMemo(() => {
    const rows = [];
    for (const r of disabled.pppoe) rows.push({ kind: "PPPoE", ...r });
    for (const r of disabled.static) rows.push({ kind: "Static", ...r });
    const s = (q || "").toLowerCase().trim();
    return rows.filter((r) => {
      const c = r.customer || {};
      const bag = [r.accountNumber, c.name, c.phone, c.email, c.address]
        .filter(Boolean)
        .map(String);
      return !s || bag.some((v) => v.toLowerCase().includes(s));
    });
  }, [disabled, q]);

  const enableAccount = async (acct) => {
    try {
      await api.post(`/pppoe/${encodeURIComponent(acct)}/enable`);
      const { data } = await api.get("/customers/disabled");
      setDisabled({ pppoe: data?.pppoe || [], static: data?.static || [] });
    } catch (e) {
      setError(e.message || "Enable failed");
    }
  };

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title="Customers">
      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
        <button
          className="btn"
          style={{ background: tab === "all" ? "#16a34a" : "#94a3b8" }}
          onClick={() => setTab("all")}
        >
          All
        </button>
        <button
          className="btn"
          style={{ background: tab === "disabled" ? "#16a34a" : "#94a3b8" }}
          onClick={() => setTab("disabled")}
        >
          Disabled/Inactive
        </button>

        <input
          placeholder="Filter..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, padding: "10px 12px", border: "1px solid #e6eaf2", borderRadius: 12 }}
        />

        <button
          className="btn"
          onClick={async () => {
            try {
              const conf = getCurrentRowsAndHeaders();
              await exportRows(conf); // XLSX if available; CSV fallback
            } catch (e) {
              setError(e?.message || "Export failed");
            }
          }}
          title="Export current view to Excel (falls back to CSV)"
        >
          Export
        </button>
      </div>

      {error && <div style={{ color: "#b91c1c", marginBottom: 8 }}>{error}</div>}

      {tab === "all" ? (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Account #</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Address</th>
                <th>Plan</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredAll.map((c) => (
                <tr key={c._id}>
                  <td>{c.accountNumber}</td>
                  <td>{c.name}</td>
                  <td>{c.phone}</td>
                  <td>{c.email}</td>
                  <td>{c.address}</td>
                  <td>{c.plan?.name || "-"}</td>
                  <td>{formatCreated(c)}</td>
                  <td>
                    <button className="btn" onClick={() => onSelect?.(c)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
              {filteredAll.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center" }}>
                    {loading ? "Loading…" : "No customers found"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Account #</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Address</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {disabledCombined.map((r, i) => (
                <tr key={`${r.kind}-${r.accountNumber}-${i}`}>
                  <td>{r.kind}</td>
                  <td>{r.accountNumber}</td>
                  <td>{r.customer?.name || "-"}</td>
                  <td>{r.customer?.phone || "-"}</td>
                  <td>{r.customer?.email || "-"}</td>
                  <td>{r.customer?.address || "-"}</td>
                  <td>{formatCreated(r.customer)}</td>
                  <td>
                    {r.kind === "PPPoE" ? (
                      <button className="btn" onClick={() => enableAccount(r.accountNumber)}>
                        Enable
                      </button>
                    ) : (
                      <span style={{ opacity: 0.6 }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
              {disabledCombined.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center" }}>
                    {loading ? "Loading…" : "No disabled accounts"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
