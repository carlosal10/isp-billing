// routes/mikrotikTerminal.js
const express = require("express");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");

// IMPORTANT: this module should execute commands via your connection manager.
// Update the signature if yours differs. We pass { tenantId, timeoutMs } in options.
const { sendCommand } = require("../utils/mikrotikConnectionManager");

const router = express.Router();

/* ---------- Security policy ----------

Tight allowlist: default to read-only commands (print/monitor/ping).
Add mutating commands (set/add/remove) only behind *separate*, audited endpoints
with explicit validation and RBAC — not the generic terminal.

*/
const ALLOW_PREFIXES = [
  "/system/resource/print",
  "/system/health/print",
  "/system/identity/print",
  "/interface/print",
  "/interface/monitor-traffic",
  "/ip/address/print",
  "/ip/route/print",
  "/ip/pool/print",
  "/ip/dhcp-server/lease/print",
  "/ppp/secret/print",
  "/ppp/profile/print",
  "/queue/simple/print",
  "/routing/route/print",
  "/tool/ping",
  "/tool/traceroute",
  "/tool/bandwidth-test",
];

const DENY_EXACT = new Set([
  "/system/reset-configuration",
  "/system/shutdown",
  "/file/remove",
  "/system/script/add",
  "/system/script/remove",
]);

const SENSITIVE_KEYS = ["password", "pass", "secret", "key", "token"];

/* ---------- Preflight ---------- */
// Do NOT authenticate OPTIONS; App.js should also have a global app.options('*', ...).
router.options("/exec", (req, res) => res.sendStatus(204));

/* ---------- Rate limit ---------- */
const limiter = rateLimit({
  windowMs: 10 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

/* ---------- Validation ---------- */
const Body = z.object({
  command: z.string().min(1).max(512),
  timeoutMs: z.number().int().min(500).max(60000).optional(),
  serverId: z.string().optional(),
});

/* ---------- Utils ---------- */
function isAllowed(path) {
  if (DENY_EXACT.has(path)) return false;
  return ALLOW_PREFIXES.some((p) => path.startsWith(p));
}

// Tokenize a simple RouterOS-like CLI string
function parseCli(command) {
  if (!command || typeof command !== "string") throw new Error("Empty command");
  const trimmed = command.trim().replace(/\s+/g, " ");
  const tokens = [];

  // tokenizer that respects double quotes
  let cur = "";
  let inQuotes = false;
  for (const ch of trimmed) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      cur += ch;
      continue;
    }
    if (!inQuotes && ch === " ") {
      if (cur) {
        tokens.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);
  if (tokens.length === 0) throw new Error("Invalid command");

  const path = tokens[0];
  if (!path.startsWith("/")) throw new Error("Command must start with a path like /ppp/secret/print");

  // Convert remaining tokens to RouterOS API "words"
  const words = [];
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];

    // RouterOS special prefixes remain as-is: ?, !, .
    if (t.startsWith("?") || t.startsWith("!") || t.startsWith(".")) {
      words.push(t);
      continue;
    }

    // key=value -> =key=value  (RouterOS API words)
    const eq = t.indexOf("=");
    if (eq > 0) {
      const key = t.slice(0, eq);
      let val = t.slice(eq + 1);
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      words.push(`=${key}=${val}`);
    } else {
      // bare token -> treat as flag with empty value
      words.push(`=${t}=`);
    }
  }

  return { path: path.toLowerCase(), words };
}

function redact(cmd) {
  let s = String(cmd);
  for (const k of SENSITIVE_KEYS) {
    const unquoted = new RegExp(`(${k}\\s*=\\s*)[^\\s"]+`, "ig");
    const quoted = new RegExp(`(${k}\\s*=\\s*")[^"]*(")`, "ig");
    s = s.replace(unquoted, "$1******").replace(quoted, "$1******$2");
  }
  return s;
}

/* ---------- Route ---------- */
router.post("/exec", limiter, async (req, res) => {
  try {
    // req.tenantId is set by your requireTenant middleware in App.js
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ ok: false, error: "Missing tenant (x-isp-id)" });

    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "Invalid payload" });

    const { command, timeoutMs = 10000, serverId: bodyServer } = parsed.data;

    const { path, words } = parseCli(command);
    if (!isAllowed(path)) return res.status(403).json({ ok: false, error: `Command not allowed: ${path}` });

    console.log("🛰️  MT exec:", redact(command));

    // Bind execution to the current tenant context
    const hdrServer = req.headers['x-isp-server'] || req.headers['x-router-id'] || null;
    const serverId = bodyServer || hdrServer || req.query?.serverId || null;
    const result = await sendCommand(path, words, { tenantId, timeoutMs, serverId });

    return res.json({ ok: true, path, words, result });
  } catch (err) {
    const msg = err?.message || "RouterOS exec failed";
    // If the underlying lib signals timeouts/auth/connectivity in the message, map to 502 (bad gateway)
    const isUpstream = /timeout|expired|auth|EHOSTUNREACH|ECONNREFUSED|network/i.test(msg);
    const code = isUpstream ? 502 : 500;
    console.error("❌ MT exec error:", msg);
    return res.status(code).json({ ok: false, error: msg });
  }
});

module.exports = router;
