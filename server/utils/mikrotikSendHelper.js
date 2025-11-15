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

async function safeSendCommand(cmd, args = [], options = {}) {
  const isHeavy = HEAVY_COMMANDS.has(String(cmd).trim());
  const retryCount = isHeavy ? HEAVY_RETRY : DEFAULT_RETRY;
  const timeoutMs = options.timeoutMs || (isHeavy ? HEAVY_TIMEOUT : DEFAULT_TIMEOUT);

  let lastErr;
  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      const res = await sendCommand(cmd, args, { ...options, timeoutMs });

      // Detect transient malformed replies
      const rawStr = typeof res === 'string' ? res : (res && res.toString ? res.toString() : '');
      if (rawStr.includes('!empty') || /UNKNOWNREPLY|RosException/i.test(rawStr)) {
        throw new Error('transient_malformed_reply: ' + rawStr.slice(0, 200));
      }

      return res;
    } catch (err) {
      lastErr = err;
      const msg = String(err.message || err);

      // If auth issue, rethrow immediately
      if (/username|password|authentication|login failure|invalid user/i.test(msg)) {
        throw err;
      }

      // Otherwise, transient: retry after delay
      const delayMs = 500 * attempt;
      console.warn(`⚠️ transient error on ${cmd} attempt ${attempt}: ${msg}. Retrying in ${delayMs}ms`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  throw lastErr || new Error(`sendCommand failed: ${cmd}`);
}

module.exports = {
  safeSendCommand
};
