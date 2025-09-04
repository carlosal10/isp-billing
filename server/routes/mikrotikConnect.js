// routes/mikrotikConnect.js
const express = require("express");
const router = express.Router();
const { setConfigLoader, sendCommand } = require("../utils/mikrotikConnectionManager");
const MikroTikConnection = require("../models/MikrotikConnection");

// Load a tenant's router config from DB
setConfigLoader(async (tenantId) => {
  const rec = await MikroTikConnection.findOne({ tenant: tenantId }).lean();
  if (!rec) return undefined;
  return {
    host: rec.host,
    port: rec.port || (rec.tls ? 8729 : 8728),
    user: rec.username,
    password: rec.password,
    tls: !!rec.tls,
    timeout: 15000,
  };
});

router.post("/", async (req, res) => {
  try {
    const tenantId = req.tenantId; // set by requireTenant
    if (!tenantId) return res.status(401).json({ ok: false, error: "Missing tenant (x-isp-id)" });

    const { host, port, user, password, tls } = req.body || {};
    if (!host || !user || !password) {
      return res.status(400).json({ ok: false, error: "host, user, password required" });
    }

    // Persist per-tenant connection config
    const doc = await MikroTikConnection.findOneAndUpdate(
      { tenant: tenantId },
      {
        $set: {
          host: String(host).trim(),
          port: Number(port) || (tls ? 8729 : 8728),
          username: String(user).trim(),
          password: String(password),
          tls: !!tls,
          updatedBy: req.user?.sub || null,
          lastVerifiedAt: null,
        },
      },
      { new: true, upsert: true }
    );

    // Test by reading identity via pooled manager (must pass tenantId!)
    const out = await sendCommand("/system/identity/print", [], { tenantId, timeoutMs: 10000 });
    const identity = Array.isArray(out) && out[0]?.name;

    // Mark verified
    try { await MikroTikConnection.updateOne({ _id: doc._id }, { $set: { lastVerifiedAt: new Date() } }); } catch {}

    return res.json({ ok: true, identity: identity || "unknown" });
  } catch (e) {
    const msg = e?.message || "Connect failed";
    const upstream = /timeout|auth|connect|EHOST|ECONN|network/i.test(msg);
    return res.status(upstream ? 502 : 500).json({ ok: false, error: msg });
  }
});

module.exports = router;
