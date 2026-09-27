const { sendCommand: sendRouterCommand } = require("../utils/mikrotikConnectionManager");

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
const SENSITIVE_RESULT_KEY = /(?:password|passphrase|secret|token|api[_-]?key|private[_-]?key|client[_-]?secret|consumer[_-]?secret)/i;
const TERMINAL_ROLES = Object.freeze(["owner", "admin"]);

function canUseTerminalRole(role) {
  return TERMINAL_ROLES.includes(String(role || '').trim().toLowerCase());
}

function isAllowed(path) {
  if (!path) return false;
  if (DENY_EXACT.has(path)) return false;
  return ALLOW_PREFIXES.includes(path);
}

function parseCli(command) {
  if (!command || typeof command !== "string") throw new Error("Empty command");

  const trimmed = command.trim().replace(/\s+/g, " ");
  const tokens = [];
  let current = "";
  let inQuotes = false;

  for (const ch of trimmed) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (!inQuotes && ch === " ") {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (current) tokens.push(current);
  if (tokens.length === 0) throw new Error("Invalid command");

  const path = String(tokens[0]).toLowerCase();
  if (!path.startsWith("/")) {
    throw new Error("Command must start with a path like /ppp/secret/print");
  }

  const words = [];
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token.startsWith("?") || token.startsWith("!") || token.startsWith(".")) {
      words.push(token);
      continue;
    }

    const eq = token.indexOf("=");
    if (eq > 0) {
      const key = token.slice(0, eq);
      let value = token.slice(eq + 1);
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      words.push(`=${key}=${value}`);
      continue;
    }

    words.push(`=${token}=`);
  }

  return { path, words };
}

function redactCommand(command) {
  let redacted = String(command || "");
  for (const key of SENSITIVE_KEYS) {
    const unquoted = new RegExp(`(${key}\\s*=\\s*)[^\\s"]+`, "ig");
    const quoted = new RegExp(`(${key}\\s*=\\s*")[^"]*(")`, "ig");
    redacted = redacted
      .replace(unquoted, "$1******")
      .replace(quoted, "$1******$2");
  }
  return redacted;
}

function redactSensitiveText(value) {
  let redacted = String(value ?? '');
  for (const key of SENSITIVE_KEYS) {
    const unquoted = new RegExp(`([?=\\s,\\{\\[]${key}\\s*=?)[^\\s,\\}\\]]+`, "ig");
    const quoted = new RegExp(`(${key}\\s*=\\s*[\\\"])[^\\\"]*([\\\"])`, "ig");
    redacted = redacted
      .replace(unquoted, "$1******")
      .replace(quoted, "$1******$2");
  }
  return redacted;
}

/**
 * RouterOS responses are provider-controlled objects and may include secret
 * fields even for read commands such as /ppp/secret/print. Redact by key and
 * scrub string-form responses before returning them to the client.
 */
function sanitizeTerminalResult(value, key = '') {
  if (SENSITIVE_RESULT_KEY.test(String(key || ''))) return '[REDACTED]';
  if (value == null) return value;
  if (Buffer.isBuffer(value)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => sanitizeTerminalResult(item));
  if (typeof value === 'string') return redactSensitiveText(value);
  if (typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeTerminalResult(entryValue, entryKey),
    ])
  );
}

function sanitizeTerminalWords(words = []) {
  return Array.isArray(words) ? words.map((word) => redactSensitiveText(word)) : [];
}

async function sendCommand(tenantId, path, words = [], options = {}) {
  if (!tenantId) throw new Error("Missing tenantId for terminal command");
  return sendRouterCommand(path, words, { tenantId, ...options });
}

module.exports = {
  ALLOW_PREFIXES,
  TERMINAL_ROLES,
  canUseTerminalRole,
  isAllowed,
  parseCli,
  redactCommand,
  redactSensitiveText,
  sanitizeTerminalResult,
  sanitizeTerminalWords,
  sendCommand,
};
