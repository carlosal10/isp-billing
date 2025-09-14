// src/components/StaticIpSetupModal.jsx
import React, { useEffect, useMemo, useState } from "react";
import { FaTimes } from "react-icons/fa";
import { MdSecurity, MdBolt, MdPreview, MdRule, MdRefresh, MdDone, MdDownloadDone, MdHistory } from "react-icons/md";
import { api } from "../lib/apiClient";
import "./PppoeModal.css"; // reuse modal styles
import "./StaticIpSetupModal.css";

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
  const [rollbacking, setRollbacking] = useState(false);
  const [rollbackPreview, setRollbackPreview] = useState(null);

  const unknownCount = unknown.length;

  useEffect(() => {
    if (!isOpen) return;
    setMsg("");
    setPreview(null);
    refreshAll();
  }, [isOpen]);

  const refreshAll = async () => {
    await Promise.all([loadDetect(), loadUnknown(), loadCustomers()]);
  };

  const loadDetect = async () => {
    try {
      const { data } = await api.get("/static/detect");
      if (data?.ok) {
        setSnapshot(data.snapshot || null);
        const segs = Array.isArray(data.snapshot?.segments) ? data.snapshot.segments : [];
        setSegments(segs);
        if (!segment && segs[0]?.name) setSegment(segs[0].name);
      }
    } catch (e) { /* ignore */ }
  };

  const loadUnknown = async () => {
    try {
      const { data } = await api.get("/static/unknown-sources");
      setUnknown(Array.isArray(data?.items) ? data.items : []);
    } catch (e) { setUnknown([]); }
  };

  const loadCustomers = async () => {
    try {
      const { data } = await api.get("/customers");
      setCustomers(Array.isArray(data) ? data.filter((c) => c.connectionType === 'static') : []);
    } catch (e) {}
  };

  const byIp = useMemo(() => {
    const lists = snapshot?.lists || {};
    const allow = new Set((lists.STATIC_ALLOW || []).map((x) => x.address));
    const block = new Set((lists.STATIC_BLOCK || []).map((x) => x.address));
    const arpMap = new Map((snapshot?.arpBindings || []).map((a) => [a.address, a]));
    function firstIpFromTarget(t) { if (!t) return null; const first = String(t).split(',')[0].trim(); const ip = first.split('/')[0].trim(); return ip; }
    const qSet = new Set((snapshot?.simpleQueues || []).map((q) => firstIpFromTarget(q.target)).filter(Boolean));
    return { allow, block, arpMap, qSet };
  }, [snapshot]);

  if (!isOpen) return null;

  async function doPreviewBootstrap() {
    setLoading(true); setMsg(""); setPreview(null);
    try {
      const { data } = await api.post("/static/bootstrap", { segment: segment || 'bridge', dryRun: true });
      if (!data?.ok) throw new Error(data?.error || "Preview failed");
      setPreview({ lists: data.toCreate?.lists || [], rules: data.toCreate?.rules || [] });
      setMsg("Preview ready");
    } catch (e) { setMsg(e?.message || "Preview failed"); }
    finally { setLoading(false); }
  }

  async function doBootstrap() {
    setLoading(true); setMsg("");
    try {
      const { data } = await api.post("/static/bootstrap", { segment: segment || 'bridge', dryRun: false });
      if (!data?.ok) throw new Error(data?.error || "Bootstrap failed");
      setMsg("Bootstrap complete");
      await loadDetect();
    } catch (e) { setMsg(e?.message || "Bootstrap failed"); }
    finally { setLoading(false); }
  }

  async function doSeed() {
    setSeeding(true); setMsg("");
    try {
      const { data } = await api.post("/static/seed-allow", {});
      if (!data?.ok) throw new Error(data?.error || "Seed failed");
      setMsg(`Seeded ${data.addedCount} IPs to STATIC_ALLOW`);
      await loadDetect();
    } catch (e) { setMsg(e?.message || "Seed failed"); }
    finally { setSeeding(false); }
  }

  async function doEnforce() {
    setEnforcing(true); setMsg("");
    try {
      const { data } = await api.post("/static/enforce", { segment: segment || 'bridge' });
      if (!data?.ok) throw new Error(data?.error || "Enforce failed");
      setMsg("Enforcement enabled");
      await loadDetect();
    } catch (e) { setMsg(e?.message || "Enforce failed"); }
    finally { setEnforcing(false); }
  }

  async function adopt(ip, createQueue) {
    try {
      await api.post("/static/adopt", { ip, comment: 'adopted-via-ui', createQueue: !!createQueue });
      await Promise.all([loadUnknown(), loadDetect()]);
    } catch {}
  }

  async function doRollbackPreview() {
    setRollbacking(true); setMsg(""); setRollbackPreview(null);
    try {
      const { data } = await api.post("/static/rollback", { dryRun: true });
      if (!data?.ok) throw new Error(data?.error || "Rollback preview failed");
      setRollbackPreview(data);
      setMsg("Rollback preview ready");
    } catch (e) { setMsg(e?.message || "Rollback preview failed"); }
    finally { setRollbacking(false); }
  }

  async function doRollback(removeRules = false) {
    setRollbacking(true); setMsg("");
    try {
      const { data } = await api.post("/static/rollback", { removeRules: !!removeRules });
      if (!data?.ok) throw new Error(data?.error || "Rollback failed");
      setMsg("Rollback applied");
      setRollbackPreview(null);
      await loadDetect();
    } catch (e) { setMsg(e?.message || "Rollback failed"); }
    finally { setRollbacking(false); }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content staticip-modal" style={{ maxWidth: 980 }}>
        <button className="close" onClick={onClose} aria-label="Close"><FaTimes /></button>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MdSecurity /> Static IP Control
        </h2>

        {msg && (
          <div className="status-msg" style={{ background: msg.toLowerCase().includes("complete") || msg.toLowerCase().includes("enabled") || msg.toLowerCase().includes("ready") ? "#ecfdf5" : undefined, borderColor: msg.toLowerCase().includes("complete") || msg.toLowerCase().includes("enabled") || msg.toLowerCase().includes("ready") ? "#bbf7d0" : undefined, color: msg.toLowerCase().includes("complete") || msg.toLowerCase().includes("enabled") || msg.toLowerCase().includes("ready") ? "#065f46" : undefined }}>
            {msg}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto auto', gap: 8, marginTop: 8 }}>
          <select value={segment} onChange={(e) => setSegment(e.target.value)}>
            {segments.map((s) => (
              <option key={s.name} value={s.name}>{s.name} {s.lanCidr ? `(${s.lanCidr})` : ''}</option>
            ))}
            {segments.length === 0 && <option value="bridge">bridge</option>}
          </select>
          <button onClick={doPreviewBootstrap} disabled={loading}><MdPreview className="inline-icon" /> Preview Bootstrap</button>
          <button onClick={doBootstrap} disabled={loading}><MdBolt className="inline-icon" /> Bootstrap</button>
          <button onClick={doSeed} disabled={seeding}><MdDownloadDone className="inline-icon" /> Seed Allow</button>
          <button onClick={doEnforce} disabled={enforcing}><MdRule className="inline-icon" /> Enable Enforcement</button>
          <button onClick={refreshAll}><MdRefresh className="inline-icon" /> Refresh</button>
        </div>

        {/* Dry-run Preview */}
        {preview && (
          <div style={{ marginTop: 10, border: '1px solid #e6eaf2', borderRadius: 12, padding: 12 }}>
            <div className="help" style={{ marginBottom: 6 }}>Bootstrap Preview</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Lists to create</div>
                {preview.lists.length ? (
                  <ul>{preview.lists.map((l) => (<li key={l}>{l}</li>))}</ul>
                ) : (<div style={{ opacity: .7 }}>No lists need creation</div>)}
              </div>
              <div>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Rules to add</div>
                {preview.rules.length ? (
                  <ul>{preview.rules.map((r) => (<li key={r}>{r}</li>))}</ul>
                ) : (<div style={{ opacity: .7 }}>No rules need creation</div>)}
              </div>
            </div>
          </div>
        )}

        {/* Monitor banner */}
        <div className="stack-sm" style={{ marginTop: 10, padding: 10, borderRadius: 12, border: '1px solid #e6eaf2', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div>
            <div style={{ fontWeight: 800, color: '#0f172a' }}>Monitor mode</div>
            <div style={{ color: '#334155' }}>{unknownCount} unknown sources observed</div>
          </div>
          <div>
            <button onClick={loadUnknown}><MdRefresh className="inline-icon" /> Refresh</button>
          </div>
        </div>

        {/* Unknown sources table */}
        <div style={{ marginTop: 10 }}>
          <div className="help">Unknown Sources</div>
          <div className="table-responsive" style={{ maxHeight: 260, overflow: 'auto', border: '1px solid #e6e9f1', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8 }}>IP</th>
                  <th style={{ textAlign: 'left', padding: 8 }}>Segment</th>
                  <th style={{ textAlign: 'left', padding: 8 }}>Queue?</th>
                  <th style={{ textAlign: 'left', padding: 8 }}>ARP Perm?</th>
                  <th style={{ textAlign: 'left', padding: 8 }}>DHCP Lease?</th>
                  <th style={{ textAlign: 'right', padding: 8 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {unknown.map((u) => (
                  <tr key={u.address} style={{ borderTop: '1px solid #eef1f6' }}>
                    <td style={{ padding: 8 }}>{u.address}</td>
                    <td style={{ padding: 8 }}>{u.segment || '-'}</td>
                    <td style={{ padding: 8 }}>{u.hasQueue ? 'Yes' : 'No'}</td>
                    <td style={{ padding: 8 }}>{u.inArpPermanent ? 'Yes' : 'No'}</td>
                    <td style={{ padding: 8 }}>{u.hasDhcpLease ? 'Yes' : 'No'}</td>
                    <td style={{ padding: 8, textAlign: 'right' }}>
                      <button onClick={() => adopt(u.address, false)}><MdDone className="inline-icon" /> Adopt</button>
                    </td>
                  </tr>
                ))}
                {unknown.length === 0 && (
                  <tr><td colSpan="6" style={{ padding: 8, opacity: .7 }}>No unknown sources yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Static clients summary */}
        <div style={{ marginTop: 14 }}>
          <div className="help">Static Clients</div>
          <div className="table-responsive" style={{ maxHeight: 260, overflow: 'auto', border: '1px solid #e6e9f1', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8 }}>Name</th>
                  <th style={{ textAlign: 'left', padding: 8 }}>Account</th>
                  <th style={{ textAlign: 'left', padding: 8 }}>IP</th>
                  <th style={{ textAlign: 'left', padding: 8 }}>Badges</th>
                  <th style={{ textAlign: 'left', padding: 8 }}>Segment</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => {
                  const ip = c?.staticConfig?.ip || '';
                  const badges = [];
                  if (byIp.allow.has(ip)) badges.push('allow-list');
                  if (byIp.block.has(ip)) badges.push('block-list');
                  if (byIp.qSet.has(ip)) badges.push('queue');
                  if (byIp.arpMap.has(ip)) badges.push('arp');
                  const seg = byIp.arpMap.get(ip)?.interface || '-';
                  return (
                    <tr key={c._id} style={{ borderTop: '1px solid #eef1f6' }}>
                      <td style={{ padding: 8 }}>{c.name || '-'}</td>
                      <td style={{ padding: 8 }}>{c.accountNumber || '-'}</td>
                      <td style={{ padding: 8 }}>{ip || '-'}</td>
                      <td style={{ padding: 8 }}>
                        {badges.length ? badges.map((b, i) => (
                          <span key={i} style={{ display: 'inline-block', padding: '2px 6px', borderRadius: 999, border: '1px solid #e6eaf2', background: '#f1f5f9', marginRight: 6 }}>{b}</span>
                        )) : <span style={{ opacity: .6 }}>none</span>}
                      </td>
                      <td style={{ padding: 8 }}>{seg}</td>
                    </tr>
                  );
                })}
                {customers.length === 0 && (
                  <tr><td colSpan="5" style={{ padding: 8, opacity: .7 }}>No static customers yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Rollback section */}
        <div style={{ marginTop: 14 }}>
          <div className="help">Rollback</div>
          <div className="stack-sm" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={doRollbackPreview} disabled={rollbacking}>
              <MdHistory className="inline-icon" /> {rollbacking ? 'Preparing…' : 'Preview Rollback'}
            </button>
            {rollbackPreview && (
              <>
                <span style={{ opacity: .8 }}>
                  addAllow {rollbackPreview.addAllow}, delAllow {rollbackPreview.delAllow}, addBlock {rollbackPreview.addBlock}, delBlock {rollbackPreview.delBlock}, rules {rollbackPreview.rules?.length || 0}
                </span>
                <button onClick={() => doRollback(false)} disabled={rollbacking}>
                  Disable Rules + Restore Lists
                </button>
                <button onClick={() => doRollback(true)} disabled={rollbacking}>
                  Remove Rules + Restore Lists
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
