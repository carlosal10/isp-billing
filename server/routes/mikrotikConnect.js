// routes/mikrotikConnect.js
const express = require("express");
const router = express.Router();

const { 
  setConfigLoader, 
  setAuditLogger, 
  sendCommand 
} = require("../utils/mikrotikConnectionManager");

const MikroTikConnection = require("../models/MikrotikConnection");
const RouterEvent = require("../models/RouterEvent");

/**
 * ------------------------------------------------------------
 * CONFIG LOADER — resolves a tenant's router config on-demand
 * ------------------------------------------------------------
 */
setConfigLoader(async (tenantId, selector = {}) => {
  if (!tenantId) return undefined;

  let rec = null;

  // Strict lookup by ID
  if (selector?.id) {
    rec = await MikroTikConnection.findOne({
      _id: selector.id,
      tenant: tenantId
    }).lean();
  }

  // Named router
  if (!rec && selector?.name) {
    rec = await MikroTikConnection.findOne({
      tenant: tenantId,
      name: selector.name
    }).lean();
  }

  // Host lookup — FIXED: clean match preventing accidental port wildcard
  if (!rec && selector?.host) {
    rec = await MikroTikConnection.findOne({
      tenant: tenantId,
      host: selector.host,
      ...(selector.port ? { port: selector.port } : {})
    }).lean();
  }

  // Primary router
  if (!rec) {
    rec = await MikroTikConnection.findOne({
      tenant: tenantId,
      primary: true
    }).lean();
  }

  // Fallback to any router for this tenant
  if (!rec) {
    rec = await MikroTikConnection.findOne({ tenant: tenantId }).lean();
  }

  if (!rec) return undefined;

  return {
    host: rec.host,
    port: rec.port || (rec.tls ? 8729 : 8728),
    user: rec.username,
    password: rec.password,
    tls: !!rec.tls,
    timeout: 15000
  };
});

/**
 * ------------------------------------------------------------
 * AUDIT LOGGER — writes essential API events to DB
 * ------------------------------------------------------------
 */
setAuditLogger(async (entry) => {
  try {
    const { tenantId, host, port, kind, ok, ms, command, wordsCount, error, at } = entry || {};
    if (!tenantId) return;

    await RouterEvent.create({
      tenantId,
      host,
      port,
      kind,
      ok,
      ms,
      command,
      wordsCount,
      error,
      at: at ? new Date(at) : new Date()
    });

  } catch (err) {
    // fail silently — logging must never break requests
  }
});

/**
 * ------------------------------------------------------------
 * POST /mikrotik-connect
 * Save or update a connection, then verify via identity print
 * ------------------------------------------------------------
 */
router.post("/", async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({
        ok: false,
        error: "Missing tenant (x-isp-id)"
      });
    }

    const { host, port, user, password, tls, name, primary } = req.body || {};

    if (!host || !user || !password) {
      return res.status(400).json({
        ok: false,
        error: "host, user, password required"
      });
    }

    const connName = String(name || "default").trim();

    // If this one is promoted to primary — demote others
    if (primary === true) {
      await MikroTikConnection.updateMany(
        { tenant: tenantId, primary: true },
        { $set: { primary: false } }
      );
    }

    // Upsert record
    const doc = await MikroTikConnection.findOneAndUpdate(
      { tenant: tenantId, name: connName },
      {
        $set: {
          host: String(host).trim(),
          port: Number(port) || (tls ? 8729 : 8728),
          username: String(user).trim(),
          password: String(password),
          tls: !!tls,
          primary: !!primary,
          updatedBy: req.user?.sub || null,
          lastVerifiedAt: null
        }
      },
      { new: true, upsert: true }
    );

    // Test connection via identity print
    const out = await sendCommand(
      "/system/identity/print",
      [],
      {
        tenantId,
        timeoutMs: 10000,
        serverId: doc._id.toString()
      }
    );

    const identity = Array.isArray(out) && out[0]?.name;

    // Mark verified
    try {
      await MikroTikConnection.updateOne(
        { _id: doc._id },
        { $set: { lastVerifiedAt: new Date() } }
      );
    } catch {}

    return res.json({
      ok: true,
      identity: identity || "unknown"
    });

  } catch (err) {
    const msg = err?.message || "Connect failed";
    const upstream = /timeout|auth|connect|EHOST|ECONN|network/i.test(msg);

    return res.status(upstream ? 502 : 500).json({
      ok: false,
      error: msg
    });
  }
});

module.exports = router;
