// routes/mikrotikConnect.js
const express = require("express");
const router = express.Router();
const { setConfigLoader, sendCommand } = require("../utils/mikrotikConnectionManager");

// Simple per-tenant in-memory store (replace with DB persist in production)
const perTenantCfg = new Map();

// Tell the connection manager how to load a tenant's router config
setConfigLoader(async (tenantId) => perTenantCfg.get(tenantId));

router.post("/", async (req, res) => {
  try {
    const tenantId = req.tenantId; // set by requireTenant
    if (!tenantId) return res.status(401).json({ ok: false, error: "Missing tenant (x-isp-id)" });

    const { host, port, user, password, tls } = req.body || {};
    if (!host || !user || !password) {
      return res.status(400).json({ ok: false, error: "host, user, password required" });
    }

    // Save/Upsert config for this tenant (swap with DB write)
    perTenantCfg.set(tenantId, {
      host: String(host).trim(),
      port: Number(port) || (tls ? 8729 : 8728),
      user: String(user).trim(),
      password: String(password),
      tls: !!tls,
      timeout: 15000,
    });

    // Test by reading identity via pooled manager (must pass tenantId!)
    const out = await sendCommand("/system/identity/print", [], { tenantId, timeoutMs: 10000 });
    const identity = Array.isArray(out) && out[0]?.name;

    return res.json({ ok: true, identity: identity || "unknown" });
  } catch (e) {
    const msg = e?.message || "Connect failed";
    const upstream = /timeout|auth|connect|EHOST|ECONN|network/i.test(msg);
    return res.status(upstream ? 502 : 500).json({ ok: false, error: msg });
  }
});

module.exports = router;
