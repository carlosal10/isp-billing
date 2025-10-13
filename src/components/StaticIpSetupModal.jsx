// src/components/StaticIpSetupModal.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaTimes } from "react-icons/fa";
import { MdSecurity, MdBolt, MdPreview, MdRule, MdRefresh, MdDone, MdDownloadDone, MdHistory } from "react-icons/md";
import { api } from "../lib/apiClient";
import "./PppoeModal.css"; // keeps your base modal tokens if any
import "./StaticIpSetupModal.css";
import useDragResize from "../hooks/useDragResize";

export default function StaticIpSetupModal({ isOpen, onClose }) {
  const [segments, setSegments] = useState([]); // from /static/detect
  const [segment, setSegment] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [preview, setPreview] = useState(null);
  const [unknown, setUnknown] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const [enforcing, setEnforcing] = useState(false);
  const [seedFromQueues, setSeedFromQueues] = useState(true);
  const [seedFromArp, setSeedFromArp] = useState(false);
  const [seedLimitToDb, setSeedLimitToDb] = useState(true);
  const [rollbacking, setRollbacking] = useState(false);
  const [rollbackPreview, setRollbackPreview] = useState(null);
  const [cleaning, setCleaning] = useState(false);
  const [cleanPreview, setCleanPreview] = useState(null);
  const containerRef = useRef(null);
  const dragHandleRef = useRef(null);
  const { getResizeHandleProps, isDraggingEnabled } = useDragResize({
    isOpen,
    containerRef,
    handleRef: dragHandleRef,
    minWidth: 880,
    minHeight: 680,
    defaultSize: { width: 1100, height: 780 },
  });
  const resizeHandles = isDraggingEnabled ? ["n", "s", "e", "w", "ne", "nw", "se", "sw"] : [];

  // Persist seed options between sessions
  useEffect(() => {
    try {
      const raw = localStorage.getItem("static.seed.opts");
      if (raw) {
        const opts = JSON.parse(raw);
        if (typeof opts.q === "boolean") setSeedFromQueues(opts.q);
        if (typeof opts.a === "boolean") setSeedFromArp(opts.a);
        if (typeof opts.limit === "boolean") setSeedLimitToDb(opts.limit);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      const data = JSON.stringify({ q: !!seedFromQueues, a: !!seedFromArp, limit: !!seedLimitToDb });
      localStorage.setItem("static.seed.opts", data);
    } catch {}
  }, [seedFromQueues, seedFromArp, seedLimitToDb]);

  const unknownCount = unknown.length;

  const loadDetect = useCallback(async () => {
    try {
      const { data } = await api.get("/static/detect");
      if (data?.ok) {
        setSnapshot(data.snapshot || null);
        const segs = Array.isArray(data.snapshot?.segments) ? data.snapshot.segments : [];
        setSegments(segs);
        if (!segment && segs[0]?.name) setSegment(segs[0].name);
      }
    } catch (e) {
      /* ignore */
    }
  }, [segment]);

  const loadUnknown = useCallback(async () => {
    try {
      const { data } = await api.get("/static/unknown-sources");
      setUnknown(Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      setUnknown([]);
    }
  }, []);

  const loadCustomers = useCallback(async () => {
    try {
      const { data } = await api.get("/customers");
      setCustomers(Array.isArray(data) ? data.filter((c) => c.connectionType === "static") : []);
    } catch (e) {}
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadDetect(), loadUnknown(), loadCustomers()]);
  }, [loadDetect, loadUnknown, loadCustomers]);

  useEffect(() => {
    if (!isOpen) return;
    setMsg("");
    setPreview(null);
    refreshAll();
  }, [isOpen, refreshAll]);

  const byIp = useMemo(() => {
    const lists = snapshot?.lists || {};
    const allow = new Set((lists.STATIC_ALLOW || []).map((x) => x.address));
    const block = new Set((lists.STATIC_BLOCK || []).map((x) => x.address));
    const arpMap = new Map((snapshot?.arpBindings || []).map((a) => [a.address, a]));
    function firstIpFromTarget(t) {
      if (!t) return null;
      const first = String(t).split(",")[0].trim();
      const ip = first.split("/")[0].trim();
      return ip;
    }
    const qSet = new Set((snapshot?.simpleQueues || []).map((q) => firstIpFromTarget(q.target)).filter(Boolean));
    return { allow, block, arpMap, qSet };
  }, [snapshot]);

  if (!isOpen) return null;

  async function doPreviewBootstrap() {
    setLoading(true);
    setMsg("");
    setPreview(null);
    try {
      const { data } = await api.post("/static/bootstrap", { segment: segment || "bridge", dryRun: true });
      if (!data?.ok) throw new Error(data?.error || "Preview failed");
      setPreview({ lists: data.toCreate?.lists || [], rules: data.toCreate?.rules || [] });
      setMsg("Preview ready");
    } catch (e) {
      setMsg(e?.message || "Preview failed");
    } finally {
      setLoading(false);
    }
  }

  async function doBootstrap() {
    setLoading(true);
    setMsg("");
    try {
      const { data } = await api.post("/static/bootstrap", { segment: segment || "bridge", dryRun: false });
      if (!data?.ok) throw new Error(data?.error || "Bootstrap failed");
      setMsg("Bootstrap complete");
      await loadDetect();
    } catch (e) {
      setMsg(e?.message || "Bootstrap failed");
    } finally {
      setLoading(false);
    }
  }

  async function doSeed() {
    setSeeding(true);
    setMsg("");
    try {
      const include = [seedFromQueues && "queues", seedFromArp && "arp"].filter(Boolean);
      const body = { include: include.length ? include : ["queues"], limitToDb: !!seedLimitToDb };
      const { data } = await api.post("/static/seed-allow", body);
      if (!data?.ok) throw new Error(data?.error || "Seed failed");
      setMsg(`Seeded ${data.addedCount} IPs to STATIC_ALLOW`);
      await loadDetect();
    } catch (e) {
      setMsg(e?.message || "Seed failed");
    } finally {
      setSeeding(false);
    }
  }

  async function doEnforce() {
    setEnforcing(true);
    setMsg("");
    try {
      const { data } = await api.post("/static/enforce", { segment: segment || "bridge" });
      if (!data?.ok) throw new Error(data?.error || "Enforce failed");
      setMsg("Enforcement enabled");
      await loadDetect();
    } catch (e) {
      setMsg(e?.message || "Enforce failed");
    } finally {
      setEnforcing(false);
    }
  }

  async function adopt(ip, createQueue) {
    try {
      await api.post("/static/adopt", { ip, comment: "adopted-via-ui", createQueue: !!createQueue });
      await Promise.all([loadUnknown(), loadDetect()]);
    } catch {}
  }

  async function doRollbackPreview() {
    setRollbacking(true);
    setMsg("");
    setRollbackPreview(null);
    try {
      const { data } = await api.post("/static/rollback", { dryRun: true });
      if (!data?.ok) throw new Error(data?.error || "Rollback preview failed");
      setRollbackPreview(data);
      setMsg("Rollback preview ready");
    } catch (e) {
      setMsg(e?.message || "Rollback preview failed");
    } finally {
      setRollbacking(false);
    }
  }

  async function doRollback(removeRules = false) {
    setRollbacking(true);
    setMsg("");
    try {
      const { data } = await api.post("/static/rollback", { removeRules: !!removeRules });
      if (!data?.ok) throw new Error(data?.error || "Rollback failed");
      setMsg("Rollback applied");
      setRollbackPreview(null);
      await loadDetect();
    } catch (e) {
      setMsg(e?.message || "Rollback failed");
    } finally {
      setRollbacking(false);
    }
  }

  async function doCleanPreview() {
    setCleaning(true);
    setMsg("");
    setCleanPreview(null);
    try {
      const { data } = await api.post("/static/clean-lists", { dryRun: true });
      if (!data?.ok) throw new Error(data?.error || "Clean preview failed");
      setCleanPreview(data);
      setMsg("Clean preview ready");
    } catch (e) {
      setMsg(e?.message || "Clean preview failed");
    } finally {
      setCleaning(false);
    }
  }

  async function doCleanApply() {
    setCleaning(true);
    setMsg("");
    try {
      const { data } = await api.post("/static/clean-lists", {});
      if (!data?.ok) throw new Error(data?.error || "Clean failed");
      setMsg(`Removed ${data.removed} stale entries`);
      setCleanPreview(null);
      await loadDetect();
    } catch (e) {
      setMsg(e?.message || "Clean failed");
    } finally {
      setCleaning(false);
    }
  }

  return (
    <div className="ps-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={containerRef} className="ps-modal staticip-modal draggable-modal">
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
        {/* Close */}
        <button className="ps-close" onClick={onClose} aria-label="Close" data-modal-no-drag>
          <FaTimes size={18} />
        </button>

        {/* Header */}
        <header className="ps-head">
          <span className="ps-chip">Network</span>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <MdSecurity /> Static IP Control
          </h2>
        </header>

        {/* Top actions */}
        <div className="ps-tabs" style={{ gap: 10, flexWrap: "wrap" }}>
          <select className="ps-input" value={segment} onChange={(e) => setSegment(e.target.value)} style={{ maxWidth: 240 }}>
            {segments.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} {s.lanCidr ? `(${s.lanCidr})` : ""}
              </option>
            ))}
            {segments.length === 0 && <option value="bridge">bridge</option>}
          </select>

          <button onClick={doPreviewBootstrap} disabled={loading} className={`ps-tab ${loading ? "" : ""}`}>
            <MdPreview className="inline-icon" /> Preview Bootstrap
          </button>
          <button onClick={doBootstrap} disabled={loading} className="ps-tab">
            <MdBolt className="inline-icon" /> Bootstrap
          </button>
          <button onClick={doSeed} disabled={seeding} className="ps-tab">
            <MdDownloadDone className="inline-icon" /> {seeding ? "Seeding…" : "Seed Allow"}
          </button>
          <button onClick={doEnforce} disabled={enforcing} className="ps-tab">
            <MdRule className="inline-icon" /> {enforcing ? "Enforcing…" : "Enable Enforcement"}
          </button>
          <button onClick={refreshAll} className="ps-tab">
            <MdRefresh className="inline-icon" /> Refresh
          </button>
        </div>

        {/* Flash message */}
        {msg && (
          <p
            className={`ps-msg ${
              /complete|enabled|ready/i.test(msg) ? "ok" : /failed|error/i.test(msg) ? "err" : ""
            }`}
          >
            {msg}
          </p>
        )}

        {/* Content body */}
        <div className="ps-form" style={{ paddingTop: 8 }}>
          {/* Bootstrap preview */}
          {preview && (
            <div style={{ border: "1px solid #e6eaf2", borderRadius: 12, padding: 12, background: "#fff" }}>
              <div className="ps-subtitle" style={{ marginBottom: 6 }}>
                Bootstrap Preview
              </div>
              <div className="ps-grid">
                <div>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Lists to create</div>
                  {preview.lists.length ? (
                    <ul>{preview.lists.map((l) => <li key={l}>{l}</li>)}</ul>
                  ) : (
                    <div style={{ opacity: 0.7 }}>No lists need creation</div>
                  )}
                </div>
                <div>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Rules to add</div>
                  {preview.rules.length ? (
                    <ul>{preview.rules.map((r) => <li key={r}>{r}</li>)}</ul>
                  ) : (
                    <div style={{ opacity: 0.7 }}>No rules need creation</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Monitor banner */}
          <div
            className="stack-sm"
            style={{
              marginTop: 6,
              padding: 12,
              borderRadius: 12,
              border: "1px solid #e6eaf2",
              background: "#f8fafc",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div>
              <div style={{ fontWeight: 800, color: "#0f172a" }}>Monitor mode</div>
              <div style={{ color: "#334155" }}>{unknownCount} unknown sources observed</div>
            </div>
            <div>
              <button onClick={loadUnknown} className="ps-tab">
                <MdRefresh className="inline-icon" /> Refresh
              </button>
            </div>
          </div>

          {/* Seed options */}
          <div style={{ padding: 12, borderRadius: 12, border: "1px solid #e6eaf2", background: "#fff" }}>
            <div className="ps-subtitle" style={{ marginBottom: 6 }}>
              Seed Options
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={seedFromQueues} onChange={() => setSeedFromQueues((v) => !v)} /> From Queues
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={seedFromArp} onChange={() => setSeedFromArp((v) => !v)} /> From ARP (LAN only)
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={seedLimitToDb} onChange={() => setSeedLimitToDb((v) => !v)} /> Limit to DB accounts only
              </label>
              <div style={{ marginLeft: "auto" }}>
                <button onClick={doSeed} disabled={seeding} className="ps-submit">
                  {seeding ? "Seeding…" : "Seed Allowed IPs"}
                </button>
              </div>
            </div>
          </div>

          {/* Unknown sources */}
          <div>
            <div className="ps-subtitle">Unknown Sources</div>
            <div className="table-responsive" style={{ maxHeight: 260, overflow: "auto", border: "1px solid #e6e9f1", borderRadius: 12, background: "#fff" }}>
              <table className="w-full" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: 10 }}>IP</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Segment</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Queue?</th>
                    <th style={{ textAlign: "left", padding: 10 }}>ARP Perm?</th>
                    <th style={{ textAlign: "left", padding: 10 }}>DHCP Lease?</th>
                    <th style={{ textAlign: "right", padding: 10 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {unknown.map((u) => (
                    <tr key={u.address} style={{ borderTop: "1px solid #eef1f6" }}>
                      <td style={{ padding: 10 }}>{u.address}</td>
                      <td style={{ padding: 10 }}>{u.segment || "-"}</td>
                      <td style={{ padding: 10 }}>{u.hasQueue ? "Yes" : "No"}</td>
                      <td style={{ padding: 10 }}>{u.inArpPermanent ? "Yes" : "No"}</td>
                      <td style={{ padding: 10 }}>{u.hasDhcpLease ? "Yes" : "No"}</td>
                      <td style={{ padding: 10, textAlign: "right" }}>
                        <button onClick={() => adopt(u.address, false)} className="ps-tab">
                          <MdDone className="inline-icon" /> Adopt
                        </button>
                      </td>
                    </tr>
                  ))}
                  {unknown.length === 0 && (
                    <tr>
                      <td colSpan="6" style={{ padding: 10, opacity: 0.7 }}>
                        No unknown sources yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Static clients */}
          <div>
            <div className="ps-subtitle">Static Clients</div>
            <div className="table-responsive" style={{ maxHeight: 260, overflow: "auto", border: "1px solid #e6e9f1", borderRadius: 12, background: "#fff" }}>
              <table className="w-full" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: 10 }}>Name</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Account</th>
                    <th style={{ textAlign: "left", padding: 10 }}>IP</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Badges</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Segment</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => {
                    const ip = c?.staticConfig?.ip || "";
                    const badges = [];
                    if (byIp.allow.has(ip)) badges.push("allow-list");
                    if (byIp.block.has(ip)) badges.push("block-list");
                    if (byIp.qSet.has(ip)) badges.push("queue");
                    if (byIp.arpMap.has(ip)) badges.push("arp");
                    const seg = byIp.arpMap.get(ip)?.interface || "-";
                    return (
                      <tr key={c._id} style={{ borderTop: "1px solid #eef1f6" }}>
                        <td style={{ padding: 10 }}>{c.name || "-"}</td>
                        <td style={{ padding: 10 }}>{c.accountNumber || "-"}</td>
                        <td style={{ padding: 10 }}>{ip || "-"}</td>
                        <td style={{ padding: 10 }}>
                          {badges.length ? (
                            badges.map((b, i) => (
                              <span
                                key={i}
                                style={{
                                  display: "inline-block",
                                  padding: "2px 8px",
                                  borderRadius: 999,
                                  border: "1px solid #e6eaf2",
                                  background: "#f1f5f9",
                                  marginRight: 6,
                                  fontSize: 12,
                                }}
                              >
                                {b}
                              </span>
                            ))
                          ) : (
                            <span style={{ opacity: 0.6 }}>none</span>
                          )}
                        </td>
                        <td style={{ padding: 10 }}>{seg}</td>
                      </tr>
                    );
                  })}
                  {customers.length === 0 && (
                    <tr>
                      <td colSpan="5" style={{ padding: 10, opacity: 0.7 }}>
                        No static customers yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Rollback */}
          <div>
            <div className="ps-subtitle">Rollback</div>
            <div className="stack-sm" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button onClick={doRollbackPreview} disabled={rollbacking} className="ps-tab">
                <MdHistory className="inline-icon" /> {rollbacking ? "Preparing…" : "Preview Rollback"}
              </button>
              {rollbackPreview && (
                <>
                  <span style={{ opacity: 0.8 }}>
                    addAllow {rollbackPreview.addAllow}, delAllow {rollbackPreview.delAllow}, addBlock{" "}
                    {rollbackPreview.addBlock}, delBlock {rollbackPreview.delBlock}, rules {rollbackPreview.rules?.length || 0}
                  </span>
                  <button onClick={() => doRollback(false)} disabled={rollbacking} className="ps-tab">
                    Disable Rules + Restore Lists
                  </button>
                  <button onClick={() => doRollback(true)} disabled={rollbacking} className="ps-tab">
                    Remove Rules + Restore Lists
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Clean lists */}
          <div>
            <div className="ps-subtitle">Clean Lists</div>
            <div className="stack-sm" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button onClick={doCleanPreview} disabled={cleaning} className="ps-tab">
                {cleaning ? "Calculating…" : "Preview Clean"}
              </button>
              {cleanPreview && (
                <>
                  <span style={{ opacity: 0.8 }}>
                    removeAllow {cleanPreview.removeAllow}, removeBlock {cleanPreview.removeBlock}
                  </span>
                  <button onClick={doCleanApply} disabled={cleaning} className="ps-tab">
                    Apply Clean
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
