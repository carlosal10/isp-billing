// routes/mikrotikAdmin.js
const express = require("express");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const { sendCommand } = require("../utils/mikrotikConnectionManager");

const router = express.Router();

// ----- Config -----
const ADDRESS_LIST = "mgmt-allow";
const MGMT_COMMENT = "mgmt-allow";
const DEFAULT_PORTS = ["22", "8291", "8728"]; // + "8729" for api-ssl if used
const STRICT_LIST = "ALLOWED-WAN";

// ----- RBAC (FIXED precedence) -----
function guardRole(req, res, next) {
  const role = req.user?.role ?? (req.user?.isAdmin ? "admin" : "user");
  if (role !== "admin" && role !== "owner" && !req.user?.isAdmin) {
    return res.status(403).json({ ok: false, error: "Insufficient privileges" });
  }
  next();
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
function normalizeCidr(ip) {
  const s = String(ip).trim();
  const v4 = s.match(/^(\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?$/);
  if (v4) {
    const [host, mask] = s.split("/");
    const octets = host.split(".").map(Number);
    if (octets.some((o) => o < 0 || o > 255)) throw new Error("Invalid IPv4");
    const cidr = Number(mask ?? 32);
    if (cidr !== 32) throw new Error("IPv4 must be /32");
    return { cidr: `${host}/32`, family: "v4" };
  }
  const v6 = s.match(/^[0-9a-f:]+(?:\/\d{1,3})?$/i);
  if (v6) {
    const [host, mask] = s.split("/");
    const cidr = Number(mask ?? 128);
    if (cidr !== 128) throw new Error("IPv6 must be /128");
    return { cidr: `${host}/128`, family: "v6" };
  }
  throw new Error("Invalid IP address");
}

// ----- Helpers (RouterOS) -----
const qs = (k, v) => `?${k}=${v}`;
const w = (k, v) => `=${k}=${v}`;
const pickId = (row) => row?.[".id"] ?? row?.id ?? row?.numbers ?? null;

async function findAddressListEntry(tenantId, cidr, timeoutMs) {
  const out = await sendCommand(
    "/ip/firewall/address-list/print",
    [qs("list", ADDRESS_LIST), qs("address", cidr)],
    { tenantId, timeoutMs }
  );
  return Array.isArray(out) && out.length ? out[0] : null;
}

async function ensureAddressList(tenantId, cidr, comment, timeoutMs) {
  const exists = await findAddressListEntry(tenantId, cidr, timeoutMs);
  if (exists) return pickId(exists);

  const words = [w("list", ADDRESS_LIST), w("address", cidr)];
  if (comment) words.push(w("comment", comment));
  const res = await sendCommand("/ip/firewall/address-list/add", words, { tenantId, timeoutMs });
  return (Array.isArray(res) && res[0] && pickId(res[0])) || true;
}

async function removeAddressList(tenantId, cidr, timeoutMs) {
  const row = await findAddressListEntry(tenantId, cidr, timeoutMs);
  if (!row) return false;
  const id = pickId(row);
  await sendCommand("/ip/firewall/address-list/remove", [w("numbers", id)], { tenantId, timeoutMs });
  return true;
}

async function findWanDropId(tenantId, timeoutMs) {
  let out = await sendCommand(
    "/ip/firewall/filter/print",
    [qs("chain", "input"), qs("comment", "wan-drop")],
    { tenantId, timeoutMs }
  );
  if (!Array.isArray(out) || out.length === 0) {
    out = await sendCommand(
      "/ip/firewall/filter/print",
      [qs("chain", "input"), qs("action", "drop"), qs("in-interface-list", "WAN")],
      { tenantId, timeoutMs }
    );
  }
  return Array.isArray(out) && out[0] ? pickId(out[0]) : null;
}

async function ensureStateRule(tenantId, timeoutMs) {
  const out = await sendCommand(
    "/ip/firewall/filter/print",
    [qs("chain", "input"), qs("connection-state", "established,related"), qs("action", "accept")],
    { tenantId, timeoutMs }
  );
  if (Array.isArray(out) && out.length) return pickId(out[0]);
  const add = await sendCommand(
    "/ip/firewall/filter/add",
    [w("chain", "input"), w("connection-state", "established,related"), w("action", "accept"), w("comment", "state-allow")],
    { tenantId, timeoutMs }
  );
  return (Array.isArray(add) && add[0] && pickId(add[0])) || true;
}

async function listInputRules(tenantId, timeoutMs) {
  const out = await sendCommand("/ip/firewall/filter/print", [qs("chain", "input")], { tenantId, timeoutMs });
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

async function ensureMgmtAllowRule(tenantId, ports, timeoutMs) {
  const portsCsv = ports.join(",");
  const rules = await listInputRules(tenantId, timeoutMs);
  const existing = rules.find((r) => mgmtRuleMatches(r, portsCsv));
  if (existing) return pickId(existing);

  const placeBefore = await findWanDropId(tenantId, timeoutMs);

  const words = [
    w("chain", "input"),
    w("action", "accept"),
    w("src-address-list", ADDRESS_LIST),
    w("protocol", "tcp"),
    w("dst-port", portsCsv),
    w("comment", MGMT_COMMENT),
  ];
  if (placeBefore) words.push(w("place-before", placeBefore));

  const add = await sendCommand("/ip/firewall/filter/add", words, { tenantId, timeoutMs });
  return (Array.isArray(add) && add[0] && pickId(add[0])) || true;
}

async function findMgmtAllowRules(tenantId, timeoutMs) {
  const rules = await listInputRules(tenantId, timeoutMs);
  return rules.filter(
    (r) => r?.action === "accept" && r?.["src-address-list"] === ADDRESS_LIST && r?.protocol === "tcp"
  );
}

async function ensureServiceAllowsIp(tenantId, serviceName, cidr, timeoutMs) {
  const rows = await sendCommand("/ip/service/print", [qs("name", serviceName)], { tenantId, timeoutMs });
  if (!Array.isArray(rows) || rows.length === 0) return;
  const row = rows[0];
  const id = pickId(row);
  const current = String(row?.address || "").trim();
  const parts = current ? current.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (parts.includes(cidr)) return id;
  const next = parts.length ? `${current},${cidr}` : cidr;
  await sendCommand("/ip/service/set", [w("numbers", id), w("address", next)], { tenantId, timeoutMs });
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

    const { cidr, family } = normalizeCidr(ip);

    const addrId = await ensureAddressList(tenantId, cidr, comment ?? "home", timeoutMs);
    const stateId = await ensureStateRule(tenantId, timeoutMs);

    const chosenPorts = mapServicesToPorts(services, ports);
    const ruleId = await ensureMgmtAllowRule(tenantId, chosenPorts, timeoutMs);

    const touchedServices = [];
    for (const s of services || []) {
      const sid = await ensureServiceAllowsIp(tenantId, s, cidr, timeoutMs).catch(() => null);
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

    const { cidr } = normalizeCidr(parsed.data.ip);
    const removed = await removeAddressList(tenantId, cidr, parsed.data.timeoutMs || 12000);

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
    const rules = await findMgmtAllowRules(tenantId, timeoutMs);
    const ports = rules.map((r) => String(r?.["dst-port"] || "")).filter(Boolean);

    // address-list entries (limit to mgmt-allow)
    const entries = await sendCommand(
      "/ip/firewall/address-list/print",
      [qs("list", ADDRESS_LIST)],
      { tenantId, timeoutMs }
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

module.exports = router;

// ===== Strict Internet Enforcement =====
// Only allow forwarding to out-interface-list in ALLOWED-WAN
// - Creates/ensures interface list and members
// - Adds/ensures masquerade NAT for ALLOWED-WAN
// - Adds/ensures drop rule for out-interface-list=!ALLOWED-WAN (forward chain)
// - Optionally disables DHCP client on specified interfaces

async function ensureInterfaceList(tenantId, name, timeoutMs) {
  const out = await sendCommand("/interface/list/print", [qs("name", name)], { tenantId, timeoutMs });
  if (Array.isArray(out) && out[0]) return pickId(out[0]);
  const add = await sendCommand("/interface/list/add", [w("name", name)], { tenantId, timeoutMs });
  return (Array.isArray(add) && add[0] && pickId(add[0])) || true;
}

async function ensureListMember(tenantId, listName, iface, timeoutMs) {
  const rows = await sendCommand(
    "/interface/list/member/print",
    [qs("list", listName), qs("interface", iface)],
    { tenantId, timeoutMs }
  );
  if (Array.isArray(rows) && rows[0]) return pickId(rows[0]);
  const add = await sendCommand(
    "/interface/list/member/add",
    [w("list", listName), w("interface", iface)],
    { tenantId, timeoutMs }
  );
  return (Array.isArray(add) && add[0] && pickId(add[0])) || true;
}

async function ensureMasqForList(tenantId, listName, timeoutMs) {
  const rows = await sendCommand(
    "/ip/firewall/nat/print",
    [qs("chain", "srcnat"), qs("action", "masquerade"), qs("comment", "isp-billing-nat")],
    { tenantId, timeoutMs }
  );
  if (Array.isArray(rows) && rows[0]) return pickId(rows[0]);
  const add = await sendCommand(
    "/ip/firewall/nat/add",
    [w("chain", "srcnat"), w("action", "masquerade"), w("out-interface-list", listName), w("comment", "isp-billing-nat")],
    { tenantId, timeoutMs }
  );
  return (Array.isArray(add) && add[0] && pickId(add[0])) || true;
}

async function ensureStrictDropRule(tenantId, listName, timeoutMs) {
  const rows = await sendCommand(
    "/ip/firewall/filter/print",
    [qs("chain", "forward"), qs("out-interface-list", `!${listName}`), qs("comment", "isp-billing-strict")],
    { tenantId, timeoutMs }
  );
  if (Array.isArray(rows) && rows[0]) return pickId(rows[0]);
  const add = await sendCommand(
    "/ip/firewall/filter/add",
    [w("chain", "forward"), w("out-interface-list", `!${listName}`), w("action", "drop"), w("comment", "isp-billing-strict")],
    { tenantId, timeoutMs }
  );
  return (Array.isArray(add) && add[0] && pickId(add[0])) || true;
}

async function disableDhcpClients(tenantId, interfaces, timeoutMs) {
  for (const iface of interfaces || []) {
    const rows = await sendCommand("/ip/dhcp-client/print", [qs("interface", iface)], { tenantId, timeoutMs });
    if (Array.isArray(rows) && rows[0]) {
      const id = pickId(rows[0]);
      await sendCommand("/ip/dhcp-client/disable", [w("numbers", id)], { tenantId, timeoutMs });
    }
  }
}

router.post("/enforce/strict-internet", limiter, guardRole, async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { allowInterfaces = [], disableDhcpOn = [] } = req.body || {};
    const timeoutMs = 12000;
    if (!Array.isArray(allowInterfaces) || allowInterfaces.length === 0) {
      return res.status(400).json({ ok: false, error: "allowInterfaces required" });
    }

    await ensureInterfaceList(tenantId, STRICT_LIST, timeoutMs);
    for (const iface of allowInterfaces) await ensureListMember(tenantId, STRICT_LIST, String(iface), timeoutMs);
    await ensureMasqForList(tenantId, STRICT_LIST, timeoutMs);
    await ensureStrictDropRule(tenantId, STRICT_LIST, timeoutMs);
    await disableDhcpClients(tenantId, disableDhcpOn, timeoutMs);

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
    // Remove drop rule
    const rows = await sendCommand(
      "/ip/firewall/filter/print",
      [qs("chain", "forward"), qs("out-interface-list", `!${STRICT_LIST}`), qs("comment", "isp-billing-strict")],
      { tenantId, timeoutMs }
    );
    if (Array.isArray(rows) && rows[0]) {
      const id = pickId(rows[0]);
      await sendCommand("/ip/firewall/filter/remove", [w("numbers", id)], { tenantId, timeoutMs });
    }
    return res.json({ ok: true, removed: true });
  } catch (e) {
    const msg = e?.message || "Remove enforcement failed";
    const upstream = /timeout|auth|connect|EHOST|ECONN|network/i.test(msg);
    return res.status(upstream ? 502 : 500).json({ ok: false, error: msg });
  }
});
