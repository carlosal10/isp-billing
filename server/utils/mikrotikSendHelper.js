// utils/mikrotikSendHelper.js
const { sendCommand } = require('./mikrotikConnectionManager');

const HEAVY_COMMANDS = new Set([
  '/ppp/secret/print',
  '/ip/hotspot/active/print',
  '/queue/simple/print'
]);

const DEFAULT_RETRY = 3;
const HEAVY_RETRY = 5;
const DEFAULT_TIMEOUT = 12_000;
const HEAVY_TIMEOUT = 60_000;
const DEFAULT_BACKOFF = (attempt) => 500 * attempt;

async function safeSendCommand(cmd, args = [], options = {}) {
  const { tenantId = 'unknown', serverId = null, timeoutMs: optTimeout, retryCount: optRetry, backoff = DEFAULT_BACKOFF } = options;
  
  const isHeavy = HEAVY_COMMANDS.has(String(cmd).trim());
  const retryCount = optRetry || (isHeavy ? HEAVY_RETRY : DEFAULT_RETRY);
  const timeoutMs = optTimeout || (isHeavy ? HEAVY_TIMEOUT : DEFAULT_TIMEOUT);

  let lastErr;
  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      const res = await sendCommand(cmd, args, { ...options, timeoutMs, serverId, tenantId });

      // Normalize output to string for transient detection
      const rawStr = typeof res === 'string' ? res : JSON.stringify(res, null, 2);
      if (rawStr.includes('!empty') || /UNKNOWNREPLY|RosException/i.test(rawStr)) {
        throw new Error(`transient_malformed_reply: ${rawStr.slice(0, 200)}`);
      }

      return res;
    } catch (err) {
      lastErr = err;
      const msg = String(err.message || err);

      // Immediate throw for auth issues
      if (/username|password|authentication|login failure|invalid user/i.test(msg)) {
        console.error(`[${tenantId}][${serverId}] ❌ Authentication failure on "${cmd}": ${msg}`);
        throw err;
      }

      // Log transient error and retry
      const delayMs = backoff(attempt);
      console.warn(`[${tenantId}][${serverId}] ⚠️ Transient error on "${cmd}" attempt ${attempt}/${retryCount}: ${msg}. Retrying in ${delayMs}ms`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  console.error(`[${tenantId}][${serverId}] ❌ sendCommand failed after ${retryCount} attempts:`, lastErr);
  throw lastErr || new Error(`sendCommand failed: ${cmd}`);
}

module.exports = {
  safeSendCommand
};
