// routes/mikrotikConnect.js
'use strict';

const express = require("express");
const router = express.Router();
const { z } = require("zod");

const { 
  setConfigLoader, 
  setAuditLogger, 
  sendCommand 
} = require("../utils/mikrotikConnectionManager");

const MikroTikConnection = require("../models/MikrotikConnection");
const RouterEvent = require("../models/RouterEvent");

// ------------------------------ Validation schemas ------------------------------
const ConnectBody = z.object({
  host: z.string().min(3).max(256),
  port: z.number().int().min(1).max(65535).optional(),
  user: z.string().min(1).max(128),
  password: z.string().min(1).max(512),
  tls: z.boolean().optional().default(false),
  name: z.string().min(1).max(128).optional().default("default"),
  primary: z.boolean().optional().default(false),
  timeoutMs: z.number().int().min(1000).max(60000).optional()
});

// ------------------------------ Config loader ------------------------------
setConfigLoader(async (tenantId, selector = {}) => {
  if (!tenantId) return undefined;

  let rec = null;

  // Strict lookup by ID (selector.id may be string or ObjectId)
  if (selector?.id) {
    try {
      rec = await MikroTikConnection.findOne({
        _id: selector.id,
        tenant: tenantId
      }).lean();
    } catch (e) {
      // ignore lookup errors; fallback to other selectors
    }
  }

  // Named router
  if (!rec && selector?.name) {
    rec = await MikroTikConnection.findOne({
      tenant: tenantId,
      name: String(selector.name).trim()
    }).lean();
  }

  // Host lookup — exact host+port match preferred
  if (!rec && selector?.host) {
    const hostTrim = String(selector.host).trim();
    const portFilter = selector.port ? { port: selector.port } : {};
    rec = await MikroTikConnection.findOne({
      tenant: tenantId,
      host: hostTrim,
      ...portFilter
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

  // normalize port and tls
  const tls = !!rec.tls;
  const port = Number(rec.port) || (tls ? 8729 : 8728);

  return {
    host: String(rec.host),
    port,
    user: String(rec.username),
    password: rec.password,
    tls,
    timeout: Number(rec.timeout) || 15000
  };
});

// ------------------------------ Audit logger ------------------------------
setAuditLogger(async (entry) => {
  try {
    if (!entry || !entry.tenantId) return;
    const { tenantId, host, port, kind, ok, ms, command, wordsCount, error, at } = entry || {};
    await RouterEvent.create({
      tenantId,
      host: host || null,
      port: port || null,
      kind: kind || null,
      ok: !!ok,
      ms: Number(ms) || null,
      command: typeof command === 'string' ? command.slice(0, 200) : null,
      wordsCount: Number(wordsCount) || 0,
      error: error ? String(error).slice(0, 200) : null,
      at: at ? new Date(at) : new Date()
    });
  } catch (err) {
    // audit must not throw — swallow errors silently
    return;
  }
});

// ------------------------------ Router connect endpoint ------------------------------
router.post("/", async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ ok: false, error: "Missing tenant (x-isp-id)" });
    }

    const parsed = ConnectBody.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "Invalid payload" });
    }

    const body = parsed.data;
    const host = String(body.host).trim();
    const port = Number(body.port) || (body.tls ? 8729 : 8728);
    const user = String(body.user).trim();
    const password = String(body.password);
    const tls = !!body.tls;
    const name = String(body.name || "default").trim();
    const primary = !!body.primary;
    const timeoutMs = Number(body.timeoutMs) || 15000;

    // Upsert the MikroTikConnection document (do not return password in response)
    if (primary === true) {
      try {
        await MikroTikConnection.updateMany(
          { tenant: tenantId, primary: true },
          { $set: { primary: false } }
        );
      } catch (_) { /* ignore */ }
    }

    const upsertDoc = {
      host,
      port,
      username: user,
      password, // stored as-is; consider vaulting or encryption in production
      tls,
      primary,
      name,
      updatedBy: req.user?.sub || null,
      lastVerifiedAt: null
    };

    const doc = await MikroTikConnection.findOneAndUpdate(
      { tenant: tenantId, name },
      { $set: upsertDoc },
      { new: true, upsert: true }
    );

    // validate we have an id
    const serverId = doc && doc._id ? String(doc._id) : null;

    // Test connection: wrap so we never leak credentials or stack traces
    let verified = false;
    let identity = null;
    let verifyError = null;

    try {
      const out = await sendCommand(
        "/system/identity/print",
        [],
        {
          tenantId,
          timeoutMs: Math.max(5000, Math.min(timeoutMs, 20000)),
          serverId
        }
      );

      if (Array.isArray(out) && out[0] && out[0].name) {
        identity = out[0].name;
        verified = true;
      } else if (out && typeof out === 'object' && out.name) {
        identity = out.name;
        verified = true;
      } else {
        // treat empty reply as unverified but don't treat as fatal
        verified = false;
        verifyError = "no-identity";
      }
    } catch (err) {
      // Map high-level network/auth errors to friendly reasons
      const msg = String(err?.message || err || '');
      if (/username|password|authentication|login failure|invalid user/i.test(msg)) {
        verifyError = "auth";
      } else if (/timeout|Connect timeout|timed out|EHOSTUNREACH|ECONNRESET|ECONNREFUSED/i.test(msg)) {
        verifyError = "connect";
      } else {
        verifyError = "other";
      }
      verified = false;
    }

    // Mark verified timestamp only if success
    if (verified && doc && doc._id) {
      try {
        await MikroTikConnection.updateOne({ _id: doc._id }, { $set: { lastVerifiedAt: new Date() } });
      } catch (_) { /* ignore */ }
    }

    return res.json({
      ok: true,
      verified,
      reason: verified ? null : verifyError,
      identity: identity || null
    });
  } catch (err) {
    const msg = String(err?.message || err || "Connect failed");
    const upstream = /timeout|auth|connect|EHOST|ECONN|network/i.test(msg);
    return res.status(upstream ? 502 : 500).json({ ok: false, error: msg });
  }
});

module.exports = router;
