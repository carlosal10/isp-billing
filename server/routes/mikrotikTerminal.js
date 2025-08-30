// routes/mikrotikTerminal.js
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { sendCommand } = require('../utils/mikrotikConnectionManager'); // you already have this

// --- Security: basic allow/deny lists (adjust for your ops policy)
const ALLOW_PREFIXES = [
  '/ppp/', '/queue/', '/ip/', '/interface/', '/tool/', '/system/resource/',
  '/routing/', '/radius/', '/user/'
];

const DENY_EXACT = new Set([
  '/system/reset-configuration',
]);

const SENSITIVE_KEYS = ['password', 'pass', 'secret', 'key', 'token'];

// Rate limit to avoid abuse
const limiter = rateLimit({ windowMs: 10 * 1000, max: 20 });

// --- Parse simple CLI into RouterOS words
// Examples:
//   "/ppp/secret/print ?name=bob"
//   "/queue/simple/add name=bob target=10.0.0.1/32 max-limit=10M/10M comment=\"via api\""
function parseCli(command) {
  if (!command || typeof command !== 'string') throw new Error('Empty command');
  const trimmed = command.trim().replace(/\s+/g, ' ');
  const tokens = [];

  // simple tokenizer that respects quoted strings
  let cur = '';
  let inQuotes = false;
  for (const ch of trimmed) {
    if (ch === '"') { inQuotes = !inQuotes; cur += ch; continue; }
    if (!inQuotes && ch === ' ') { if (cur) { tokens.push(cur); cur=''; } continue; }
    cur += ch;
  }
  if (cur) tokens.push(cur);

  if (tokens.length === 0) throw new Error('Invalid command');
  const path = tokens[0]; // must start with '/'
  if (!path.startsWith('/')) throw new Error('Command must start with a path like /ppp/secret/print');

  const words = [];
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];

    // keep RouterOS special prefixes as-is
    if (t.startsWith('?') || t.startsWith('!') || t.startsWith('.')) {
      words.push(t);
      continue;
    }

    // key=value → =key=value
    const eq = t.indexOf('=');
    if (eq > 0) {
      const key = t.slice(0, eq);
      let val = t.slice(eq + 1);

      // strip surrounding quotes if any
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);

      words.push(`=${key}=${val}`);
    } else {
      // bare token → treat as switch with empty value: =token=
      words.push(`=${t}=`);
    }
  }

  return { path, words };
}

// sanitize logs (don’t print secrets)
function redact(command) {
  let redacted = command;
  for (const k of SENSITIVE_KEYS) {
    const re = new RegExp(`(${k}\\s*=\\s*)[^\\s"]+`, 'ig');
    const reQ = new RegExp(`(${k}\\s*=\\s*")[^"]*(")`, 'ig');
    redacted = redacted.replace(re, '$1******').replace(reQ, '$1******$2');
  }
  return redacted;
}

function isAllowed(path) {
  if (DENY_EXACT.has(path)) return false;
  return ALLOW_PREFIXES.some(p => path.startsWith(p));
}

router.post('/exec', limiter, async (req, res) => {
  try {
    const { command, timeoutMs } = req.body || {};
    if (!command) return res.status(400).json({ error: 'command is required' });

    const { path, words } = parseCli(command);

    if (!isAllowed(path)) {
      return res.status(403).json({ error: `Command not allowed: ${path}` });
    }

    console.log('🛰️  MT exec:', redact(command));
    const result = await sendCommand(path, words, { timeoutMs: timeoutMs || 10000 });

    // Most RouterOS libs return either an array of rows or an OK/!done
    res.json({ ok: true, path, words, result });
  } catch (err) {
    console.error('❌ MT exec error:', err?.message || err);
    res.status(500).json({ ok: false, error: err?.message || 'RouterOS exec failed' });
  }
});

module.exports = router;
