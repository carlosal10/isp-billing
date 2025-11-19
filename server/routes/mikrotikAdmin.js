// routes/mikrotikAdmin.js
'use strict';

// Admin/manage routes for MikroTik (whitelists, enforcement, bootstrap, static helpers)
// Fixes: pass serverId through helper functions (avoid using `req` inside helpers),
// ensure helper functions accept serverId where they call sendCommand.

const express = require("express");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const { sendCommand } = require("../utils/mikrotikConnectionManager");
const Membership = require("../models/Membership");

const router = express.Router();

// ----- small helper (copied from your other file) -----
function pickServerId(req) {
  // prefer explicit header but handle case-insensitive headers & typed values
  const headers = req.headers || {};
  const get = (k) => (headers[k] ?? headers[k.toLowerCase()] ?? null);
  const raw = get('x-isp-server') || get('x-router-id') || req.query?.serverId || req.query?.server || null;
  if (!raw) return null;
  const s = String(raw).trim();
  // basic whitelist: disallow characters that look like shell/URI injection
  if (/[^\w\-\_\.]/.test(s)) {
    // keep it simple: allow only typical id chars
    return null;
  }
  return s;
}


// ----- Config -----
const ADDRESS_LIST = "mgmt-allow";
const MGMT_COMMENT = "mgmt-allow";
const DEFAULT_PORTS = ["22", "8291", "8728"]; // + "8729" for api-ssl if used
const STRICT_LIST = "ALLOWED-WAN";

// ----- RBAC (FIXED precedence) -----
async function guardRole(req, res, next) {
  try {
    const userId = req.user?.sub;
    const tenantId = req.tenantId;
    let role = req.user?.role ?? (req.user?.isAdmin ? "admin" : null);
    if (!role && userId && tenantId) {
      const m = await Membership.findOne({ user: userId, tenant: tenantId }).lean();
      role = m?.role || null; // owner | admin | operator
    }
    if (role === "owner" || role === "admin" || req.user?.isAdmin) return next();
    return res.status(403).json({ ok: false, error: "Insufficient privileges" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Role check failed" });
  }
}

// ----- Validation -----
const Body = z.object({
  ip: z.string().min(3).max(64),
  services: z.array(z.enum(["winbox", "ssh", "api", "api-ssl"])).optional().default([]),
  comment: z.string().max(100).optional(),
  ports: z.array(z.string().regex(/^\d+$/)).optional(),
  timeoutMs: z.number().int().min(500).max(60000).optional(),
});

const DeleteBody = z.object({
  ip: z.string().min(3).max(64),
  timeoutMs: z.number().int().min(500).max(60000).optional(),
});

// Strict IP(/CIDR) validation
// replace normalizeCidr with this (supports optional mask requirement)
function normalizeCidr(ip, opts = { requireHostMask: 32 /* for v4, 128 for v6, or null to allow any */ }) {
  const s = String(ip).trim();
  const requireHostMask = opts.requireHostMask ?? 32;
  // IPv4
  const v4 = s.match(/^(\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?$/);
  if (v4) {
    const [host, mask] = s.split("/");
    const octets = host.split(".").map(Number);
    if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) throw new Error("Invalid IPv4");
    const cidrNum = Number(mask ?? 32);
    if (requireHostMask !== null && cidrNum !== Number(requireHostMask)) {
      throw new Error(`IPv4 must be /${requireHostMask}`);
    }
    if (cidrNum < 0 || cidrNum > 32) throw new Error("Invalid IPv4 mask");
    return { cidr: `${host}/${cidrNum}`, family: "v4" };
  }
  // IPv6 (basic)
  const v6 = s.match(/^[0-9a-f:]+(?:\/\d{1,3})?$/i);
  if (v6) {
    const [host, mask] = s.split("/");
    const cidrNum = Number(mask ?? 128);
    if (requireHostMask !== null && cidrNum !== Number(requireHostMask)) {
      throw new Error(`IPv6 must be /${requireHostMask}`);
    }
    if (cidrNum < 0 || cidrNum > 128) throw new Error("Invalid IPv6 mask");
    return { cidr: `${host}/${cidrNum}`, family: "v6" };
  }
  throw new Error("Invalid IP address");
}


// ----- Helpers (RouterOS) -----
const qs = (k, v) => `?${k}=${v}`;
const w = (k, v) => `=${k}=${v}`;
const pickId = (row) => row?.[".id"] ?? row?.id ?? row?.numbers ?? null;

async function findAddressListEntry(tenantId, cidr, timeoutMs, serverId = null) {
  const out = await sendCommand(
    "/ip/firewall/address-list/print",
    [qs("list", ADDRESS_LIST), qs("address", cidr)],
    { tenantId, timeoutMs, serverId }
  );
  return Array.isArray(out) && out.length ? out[0] : null;
}

// accept serverId param instead of referencing req inside helper
async function ensureAddressList(tenantId, cidr, comment, timeoutMs, serverId = null) {
  const exists = await findAddressListEntry(tenantId, cidr, timeoutMs, serverId);
  if (exists) return pickId(exists);

  const words = [w("list", ADDRESS_LIST), w("address", cidr)];
  if (comment) words.push(w("comment", comment));
  const res = await sendCommand("/ip/firewall/address-list/add", words, { tenantId, timeoutMs, serverId });
  return (Array.isArray(res) && res[0] && pickId(res[0])) || true;
}

async function removeAddressList(tenantId, cidr, timeoutMs, serverId = null) {
  const row = await findAddressListEntry(tenantId, cidr, timeoutMs, serverId);
  if (!row) return false;
  const id = pickId(row);
  await sendCommand("/ip/firewall/address-list/remove", [w("numbers", id)], { tenantId, timeoutMs, serverId });
  return true;
}

async function findWanDropId(tenantId, timeoutMs, serverId = null) {
  let out = await sendCommand(
    "/ip/firewall/filter/print",
    [qs("chain", "input"), qs("comment", "wan-drop")],
    { tenantId, timeoutMs, serverId }
  );
  if (!Array.isArray(out) || out.length === 0) {
    out = await sendCommand(
      "/ip/firewall/filter/print",
      [qs("chain", "input"), qs("action", "drop"), qs("in-interface-list", "WAN")],
      { tenantId, timeoutMs, serverId }
    );
  }
  return Array.isArray(out) && out[0] ? pickId(out[0]) : null;
}

async function ensureStateRule(tenantId, timeoutMs, serverId = null) {
  const out = await sendCommand(
    "/ip/firewall/filter/print",
    [qs("chain", "input"), qs("connection-state", "established,related"), qs("action", "accept")],
    { tenantId, timeoutMs, serverId }
  );
  if (Array.isArray(out) && out.length) return pickId(out[0]);
  const add = await sendCommand(
    "/ip/firewall/filter/add",
    [w("chain", "input"), w("connection-state", "established,related"), w("action", "accept"), w("comment", "state-allow")],
    { tenantId, timeoutMs, serverId }
  );
  return (Array.isArray(add) && add[0] && pickId(add[0])) || true;
}

async function listInputRules(tenantId, timeoutMs, serverId = null) {
  const out = await sendCommand("/ip/firewall/filter/print", [qs("chain", "input")], { tenantId, timeoutMs, serverId });
  return Array.isArray(out) ? out : [];
}

function mgmtRuleMatches(row, portsCsv) {
  return (
    row?.action === "accept" &&
    row?.["src-address-list"] === ADDRESS_LIST &&
    row?.protocol === "tcp" &&
    String(row?.["dst-port"] || "") === portsCsv
  );
}

async function ensureMgmtAllowRule(tenantId, ports, timeoutMs, serverId = null) {
  const portsCsv = ports.join(",");
  const rules = await listInputRules(tenantId, timeoutMs, serverId);
  const existing = rules.find((r) => mgmtRuleMatches(r, portsCsv));
  if (existing) return pickId(existing);

  const placeBefore = await findWanDropId(tenantId, timeoutMs, serverId);

  const words = [
    w("chain", "input"),
    w("action", "accept"),
    w("src-address-list", ADDRESS_LIST),
    w("protocol", "tcp"),
    w("dst-port", portsCsv),
    w("comment", MGMT_COMMENT),
  ];
  if (placeBefore) words.push(w("place-before", placeBefore));

  const add = await sendCommand("/ip/firewall/filter/add", words, { tenantId, timeoutMs, serverId });
  return (Array.isArray(add) && add[0] && pickId(add[0])) || true;
}

async function findMgmtAllowRules(tenantId, timeoutMs, serverId = null) {
  const rules = await listInputRules(tenantId, timeoutMs, serverId);
  return rules.filter(
    (r) => r?.action === "accept" && r?.["src-address-list"] === ADDRESS_LIST && r?.protocol === "tcp"
  );
}

async function ensureServiceAllowsIp(tenantId, serviceName, cidr, timeoutMs, serverId = null) {
  const rows = await sendCommand("/ip/service/print", [qs("name", serviceName)], { tenantId, timeoutMs, serverId });
  if (!Array.isArray(rows) || rows.length === 0) return;
  const row = rows[0];
  const id = pickId(row);
  const current = String(row?.address || "").trim();
  const parts = current ? current.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (parts.includes(cidr)) return id;
  const next = parts.length ? `${current},${cidr}` : cidr;
  await sendCommand("/ip/service/set", [w("numbers", id), w("address", next)], { tenantId, timeoutMs, serverId });
  return id;
}

function mapServicesToPorts(services, portsOverride) {
  if (Array.isArray(portsOverride) && portsOverride.length) {
    return Array.from(new Set(portsOverride.map(String))).sort((a, b) => Number(a) - Number(b));
  }
  const set = new Set();
  if (!services || services.length === 0) {
    DEFAULT_PORTS.forEach((p) => set.add(p));
  } else {
    if (services.includes("ssh")) set.add("22");
    if (services.includes("winbox")) set.add("8291");
    if (services.includes("api")) set.add("8728");
    if (services.includes("api-ssl")) set.add("8729");
  }
  return Array.from(set).sort((a, b) => Number(a) - Number(b));
}

// ----- Rate limit -----
const limiter = rateLimit({ windowMs: 10 * 1000, max: 10, standardHeaders: true });

// ===== Routes =====

// Create/ensure whitelist (idempotent)
router.post("/whitelist", limiter, guardRole, async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ ok: false, error: "Missing tenant (x-isp-id)" });

    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid payload" });

    const { ip, services, comment, ports, timeoutMs = 12000 } = parsed.data;
    const serverId = pickServerId(req);

    const { cidr, family } = normalizeCidr(ip);

    const addrId = await ensureAddressList(tenantId, cidr, comment ?? "home", timeoutMs, serverId);
    const stateId = await ensureStateRule(tenantId, timeoutMs, serverId);

    const chosenPorts = mapServicesToPorts(services, ports);
    const ruleId = await ensureMgmtAllowRule(tenantId, chosenPorts, timeoutMs, serverId);

    const touchedServices = [];
    for (const s of services || []) {
      const sid = await ensureServiceAllowsIp(tenantId, s, cidr, timeoutMs, serverId).catch(() => null);
      if (sid) touchedServices.push({ service: s, id: sid });
    }

    return res.json({
      ok: true,
      tenantId,
      ip: cidr,
      family,
      addressList: { id: addrId, list: ADDRESS_LIST },
      stateRule: { id: stateId },
      mgmtAllowRule: { id: ruleId, dstPorts: chosenPorts },
      services: touchedServices,
    });
  } catch (e) {
    const msg = e?.message || "Whitelist failed";
    const upstream = /timeout|auth|connect|EHOSTUNREACH|ECONN|network/i.test(msg);
    return res.status(upstream ? 502 : 500).json({ ok: false, error: msg });
  }
});

// Remove from whitelist (address-list only; rules stay)
router.delete("/whitelist", limiter, guardRole, async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ ok: false, error: "Missing tenant (x-isp-id)" });

    const parsed = DeleteBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid payload" });

    const serverId = pickServerId(req);
    const { cidr } = normalizeCidr(parsed.data.ip);
    const removed = await removeAddressList(tenantId, cidr, parsed.data.timeoutMs || 12000, serverId);

    return res.json({ ok: true, removed, ip: cidr });
  } catch (e) {
    const msg = e?.message || "Unwhitelist failed";
    const upstream = /timeout|auth|connect|EHOSTUNREACH|ECONN|network/i.test(msg);
    return res.status(upstream ? 502 : 500).json({ ok: false, error: msg });
  }
});

// Quick status: shows current mgmt allow rules + address-list entry presence
router.get("/status", limiter, guardRole, async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ ok: false, error: "Missing tenant (x-isp-id)" });

    const timeoutMs = 8000;
    const serverId = pickServerId(req);
    const rules = await findMgmtAllowRules(tenantId, timeoutMs, serverId);
    const ports = rules.map((r) => String(r?.["dst-port"] || "")).filter(Boolean);

    // address-list entries (limit to mgmt-allow)
    const entries = await sendCommand(
      "/ip/firewall/address-list/print",
      [qs("list", ADDRESS_LIST)],
      { tenantId, timeoutMs, serverId }
    );

    return res.json({
      ok: true,
      mgmtAllowRules: rules.map((r) => ({ id: pickId(r), ports: String(r?.["dst-port"] || "") })),
      addressList: Array.isArray(entries)
        ? entries.map((e) => ({ id: pickId(e), address: e.address, comment: e.comment }))
        : [],
    });
  } catch (e) {
    const msg = e?.message || "Status failed";
    const upstream = /timeout|auth|connect|EHOSTUNREACH|ECONN|network/i.test(msg);
    return res.status(upstream ? 502 : 500).json({ ok: false, error: msg });
  }
});

/*
  ===== Additional enforcement, bootstrap and static helpers follow =====
  The functions below also accept serverId where they invoke sendCommand to
  avoid referencing `req` from helper scope. When you call these helpers from
  routes, pass `pickServerId(req)` as the last argument.
*/

// ===== Strict Internet Enforcement =====

async function ensureInterfaceList(tenantId, name, timeoutMs, serverId = null) {
  const out = await sendCommand("/interface/list/print", [qs("name", name)], { tenantId, timeoutMs, serverId });
  if (Array.isArray(out) && out[0]) return pickId(out[0]);
  const add = await sendCommand("/interface/list/add", [w("name", name)], { tenantId, timeoutMs, serverId });
  return (Array.isArray(add) && add[0] && pickId(add[0])) || true;
}

async function ensureListMember(tenantId, listName, iface, timeoutMs, serverId = null) {
  const rows = await sendCommand(
    "/interface/list/member/print",
    [qs("list", listName), qs("interface", iface)],
    { tenantId, timeoutMs, serverId }
  );
  if (Array.isArray(rows) && rows[0]) return pickId(rows[0]);
  const add = await sendCommand(
    "/interface/list/member/add",
    [w("list", listName), w("interface", iface)],
    { tenantId, timeoutMs, serverId }
  );
  return (Array.isArray(add) && add[0] && pickId(add[0])) || true;
}

async function ensureMasqForList(tenantId, listName, timeoutMs, serverId = null) {
  const rows = await sendCommand(
    "/ip/firewall/nat/print",
    [qs("chain", "srcnat"), qs("action", "masquerade"), qs("comment", "isp-billing-nat")],
    { tenantId, timeoutMs, serverId }
  );
  if (Array.isArray(rows) && rows[0]) return pickId(rows[0]);
  const add = await sendCommand(
    "/ip/firewall/nat/add",
    [w("chain", "srcnat"), w("action", "masquerade"), w("out-interface-list", listName), w("comment", "isp-billing-nat")],
    { tenantId, timeoutMs, serverId }
  );
  return (Array.isArray(add) && add[0] && pickId(add[0])) || true;
}

async function ensureStrictDropRule(tenantId, listName, timeoutMs, serverId = null) {
  const rows = await sendCommand(
    "/ip/firewall/filter/print",
    [qs("chain", "forward"), qs("out-interface-list", `!${listName}`), qs("comment", "isp-billing-strict")],
    { tenantId, timeoutMs, serverId }
  );
  if (Array.isArray(rows) && rows[0]) return pickId(rows[0]);
  const add = await sendCommand(
    "/ip/firewall/filter/add",
    [w("chain", "forward"), w("out-interface-list", `!${listName}`), w("action", "drop"), w("comment", "isp-billing-strict")],
    { tenantId, timeoutMs, serverId }
  );
  return (Array.isArray(add) && add[0] && pickId(add[0])) || true;
}

async function disableDhcpClients(tenantId, interfaces, timeoutMs, serverId = null) {
  for (const iface of interfaces || []) {
    const rows = await sendCommand("/ip/dhcp-client/print", [qs("interface", iface)], { tenantId, timeoutMs, serverId });
    if (Array.isArray(rows) && rows[0]) {
      const id = pickId(rows[0]);
      await sendCommand("/ip/dhcp-client/disable", [w("numbers", id)], { tenantId, timeoutMs, serverId });
    }
  }
}

router.post("/enforce/strict-internet", limiter, guardRole, async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { allowInterfaces = [], disableDhcpOn = [] } = req.body || {};
    const timeoutMs = 12000;
    const serverId = pickServerId(req);
    if (!Array.isArray(allowInterfaces) || allowInterfaces.length === 0) {
      return res.status(400).json({ ok: false, error: "allowInterfaces required" });
    }

    await ensureInterfaceList(tenantId, STRICT_LIST, timeoutMs, serverId);
    for (const iface of allowInterfaces) await ensureListMember(tenantId, STRICT_LIST, String(iface), timeoutMs, serverId);
    await ensureMasqForList(tenantId, STRICT_LIST, timeoutMs, serverId);
    await ensureStrictDropRule(tenantId, STRICT_LIST, timeoutMs, serverId);
    await disableDhcpClients(tenantId, disableDhcpOn, timeoutMs, serverId);

    return res.json({ ok: true, list: STRICT_LIST, allowInterfaces, dhcpDisabledOn: disableDhcpOn });
  } catch (e) {
    const msg = e?.message || "Enforcement failed";
    const upstream = /timeout|auth|connect|EHOST|ECONN|network/i.test(msg);
    return res.status(upstream ? 502 : 500).json({ ok: false, error: msg });
  }
});

router.delete("/enforce/strict-internet", limiter, guardRole, async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const timeoutMs = 12000;
    const serverId = pickServerId(req);
    // Remove drop rule
    const rows = await sendCommand(
      "/ip/firewall/filter/print",
      [qs("chain", "forward"), qs("out-interface-list", `!${STRICT_LIST}`), qs("comment", "isp-billing-strict")],
      { tenantId, timeoutMs, serverId }
    );
    if (Array.isArray(rows) && rows[0]) {
      const id = pickId(rows[0]);
      await sendCommand("/ip/firewall/filter/remove", [w("numbers", id)], { tenantId, timeoutMs, serverId });
    }
    return res.json({ ok: true, removed: true });
  } catch (e) {
    const msg = e?.message || "Remove enforcement failed";
    const upstream = /timeout|auth|connect|EHOST|ECONN|network/i.test(msg);
    return res.status(upstream ? 502 : 500).json({ ok: false, error: msg });
  }
});

// ===== Static-IP + PPPoE Bootstrap =====
const STATIC_ALLOW = "STATIC_ALLOW";
const STATIC_BLOCK = "STATIC_BLOCK";

async function ensureAddressListByName(tenantId, name, comment, timeoutMs, serverId = null) {
  const rows = await sendCommand("/ip/firewall/address-list/print", [qs("list", name)], { tenantId, timeoutMs, serverId });
  if (Array.isArray(rows) && rows.length) return pickId(rows[0]);
  const add = await sendCommand(
    "/ip/firewall/address-list/add",
    [w("list", name), w("comment", comment || name)],
    { tenantId, timeoutMs, serverId }
  );
  return (Array.isArray(add) && add[0] && pickId(add[0])) || true;
}

async function findFilterIdByComment(tenantId, comment, timeoutMs, serverId = null) {
  const rows = await sendCommand("/ip/firewall/filter/print", [qs("comment", comment)], { tenantId, timeoutMs, serverId });
  return Array.isArray(rows) && rows[0] ? pickId(rows[0]) : null;
}

async function ensureFilterRule(tenantId, { chain, action, comment, matches = [] }, timeoutMs, serverId = null) {
  const id = await findFilterIdByComment(tenantId, comment, timeoutMs, serverId);
  if (id) return id;
  const words = [w("chain", chain), w("action", action), w("comment", comment), ...matches];
  const add = await sendCommand("/ip/firewall/filter/add", words, { tenantId, timeoutMs, serverId });
  return (Array.isArray(add) && add[0] && pickId(add[0])) || true;
}

async function moveRule(tenantId, numbers, destination, timeoutMs, serverId = null) {
  try {
    await sendCommand("/ip/firewall/filter/move", [w("numbers", numbers), w("destination", destination)], {
      tenantId,
      timeoutMs,
      serverId,
    });
    return true;
  } catch {
    return false;
  }
}

router.post("/bootstrap/static-ip", limiter, guardRole, async (req, res) => {
  const tenantId = req.tenantId;
  const bridge = String(req.body?.bridge || "bridge1");
  const timeoutMs = 12000;
  const serverId = pickServerId(req);
  try {
    const summary = { createdLists: [], ensuredRules: [], moved: [], dhcpDisabledOn: [] };

    // Lists
    await ensureAddressListByName(tenantId, STATIC_ALLOW, "Billing: allowed static clients", timeoutMs, serverId);
    await ensureAddressListByName(tenantId, STATIC_BLOCK, "Billing: blocked static clients", timeoutMs, serverId);
    summary.createdLists = [STATIC_ALLOW, STATIC_BLOCK];

    // Rules (comments are used as stable identifiers)
    const EST = "EST/REL";
    const ALLOW_STATIC = "Allow paid static IPs";
    const BLOCK_STATIC = "Block unpaid static IPs";
    const DROP_UNKNOWN = "Drop unknown (non-PPPoE, non-Static) from customer bridge";

    const estId = await ensureFilterRule(
      tenantId,
      { chain: "forward", action: "accept", comment: EST, matches: [w("connection-state", "established,related")] },
      timeoutMs,
      serverId
    );
    const allowId = await ensureFilterRule(
      tenantId,
      { chain: "forward", action: "accept", comment: ALLOW_STATIC, matches: [w("src-address-list", STATIC_ALLOW)] },
      timeoutMs,
      serverId
    );
    const blockId = await ensureFilterRule(
      tenantId,
      { chain: "forward", action: "drop", comment: BLOCK_STATIC, matches: [w("src-address-list", STATIC_BLOCK)] },
      timeoutMs,
      serverId
    );
    const dropUnknownId = await ensureFilterRule(
      tenantId,
      { chain: "forward", action: "drop", comment: DROP_UNKNOWN, matches: [w("in-interface", bridge)] },
      timeoutMs,
      serverId
    );
    summary.ensuredRules = [String(estId), String(allowId), String(blockId), String(dropUnknownId)];

    // Order: EST -> Allow -> Block -> DropUnknown
    await moveRule(tenantId, estId, 0, timeoutMs, serverId);
    const estAgain = await findFilterIdByComment(tenantId, EST, timeoutMs, serverId);
    const allowAgain = await findFilterIdByComment(tenantId, ALLOW_STATIC, timeoutMs, serverId);
    const blockAgain = await findFilterIdByComment(tenantId, BLOCK_STATIC, timeoutMs, serverId);
    const dropAgain = await findFilterIdByComment(tenantId, DROP_UNKNOWN, timeoutMs, serverId);
    if (estAgain && allowAgain) await moveRule(tenantId, allowAgain, estAgain, timeoutMs, serverId);
    const allowPos = await findFilterIdByComment(tenantId, ALLOW_STATIC, timeoutMs, serverId);
    if (allowPos && blockAgain) await moveRule(tenantId, blockAgain, allowPos, timeoutMs, serverId);
    const blockPos = await findFilterIdByComment(tenantId, BLOCK_STATIC, timeoutMs, serverId);
    if (blockPos && dropAgain) await moveRule(tenantId, dropAgain, blockPos, timeoutMs, serverId);

    // Disable DHCP servers bound to this bridge
    const dhcp = await sendCommand("/ip/dhcp-server/print", [qs("disabled", "no"), qs("interface", bridge)], {
      tenantId,
      timeoutMs,
      serverId,
    });
    if (Array.isArray(dhcp)) {
      for (const row of dhcp) {
        const id = pickId(row);
        if (!id) continue;
        await sendCommand("/ip/dhcp-server/disable", [w("numbers", id)], { tenantId, timeoutMs, serverId });
        summary.dhcpDisabledOn.push({ id, name: row.name, interface: row.interface });
      }
    }

    return res.json({ ok: true, bridge, summary });
  } catch (e) {
    const msg = e?.message || "Bootstrap failed";
    const upstream = /timeout|auth|connect|EHOST|ECONN|network/i.test(msg);
    return res.status(upstream ? 502 : 500).json({ ok: false, error: msg });
  }
});

// Convenience endpoints to manage static customers in address-lists
router.post("/static/allow", limiter, guardRole, async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const serverId = pickServerId(req);
    const { address, comment } = req.body || {};
    if (!address) return res.status(400).json({ ok: false, error: "address required" });
    const add = await sendCommand(
      "/ip/firewall/address-list/add",
      [w("list", STATIC_ALLOW), w("address", String(address)), comment ? w("comment", String(comment)) : null].filter(Boolean),
      { tenantId, timeoutMs: 8000, serverId }
    );
    return res.json({ ok: true, id: pickId(Array.isArray(add) ? add[0] : {}) });
  } catch (e) {
    const msg = e?.message || "Add allow failed";
    const upstream = /timeout|auth|connect|EHOST|ECONN|network/i.test(msg);
    return res.status(upstream ? 502 : 500).json({ ok: false, error: msg });
  }
});

router.post("/static/block", limiter, guardRole, async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const serverId = pickServerId(req);
    const { address, comment } = req.body || {};
    if (!address) return res.status(400).json({ ok: false, error: "address required" });
    const add = await sendCommand(
      "/ip/firewall/address-list/add",
      [w("list", STATIC_BLOCK), w("address", String(address)), comment ? w("comment", String(comment)) : null].filter(Boolean),
      { tenantId, timeoutMs: 8000, serverId }
    );
    return res.json({ ok: true, id: pickId(Array.isArray(add) ? add[0] : {}) });
  } catch (e) {
    const msg = e?.message || "Add block failed";
    const upstream = /timeout|auth|connect|EHOST|ECONN|network/i.test(msg);
    return res.status(upstream ? 502 : 500).json({ ok: false, error: msg });
  }
});

router.post("/static/renew", limiter, guardRole, async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const serverId = pickServerId(req);
    const { address, comment } = req.body || {};
    if (!address) return res.status(400).json({ ok: false, error: "address required" });
    // remove from block
    const blocked = await sendCommand(
      "/ip/firewall/address-list/print",
      [qs("list", STATIC_BLOCK), qs("address", String(address))],
      { tenantId, timeoutMs: 8000, serverId }
    );
    if (Array.isArray(blocked)) {
      for (const r of blocked) {
        const id = pickId(r);
        if (id) await sendCommand("/ip/firewall/address-list/remove", [w("numbers", id)], { tenantId, timeoutMs: 8000, serverId });
      }
    }
    // add back to allow
    const add = await sendCommand(
      "/ip/firewall/address-list/add",
      [w("list", STATIC_ALLOW), w("address", String(address)), comment ? w("comment", String(comment)) : null].filter(Boolean),
      { tenantId, timeoutMs: 8000, serverId }
    );
    return res.json({ ok: true, id: pickId(Array.isArray(add) ? add[0] : {}) });
  } catch (e) {
    const msg = e?.message || "Renew failed";
    const upstream = /timeout|auth|connect|EHOST|ECONN|network/i.test(msg);
    return res.status(upstream ? 502 : 500).json({ ok: false, error: msg });
  }
});

// final export
module.exports = router;
