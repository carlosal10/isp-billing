const { sendCommand } = require('./mikrotikConnectionManager');

/**
 * Apply a simple firewall rule for a static customer. The rule will be
 * inserted into the MikroTik firewall filter table to explicitly allow
 * traffic sourced from the assigned IP. Errors are logged but not
 * propagated.
 *
 * @param {string} tenantId
 * @param {string|null} serverId
 * @param {string} ip
 */
async function applyStaticFirewall(tenantId, serverId, ip) {
  if (!ip) return;
  try {
    await sendCommand('/ip/firewall/filter/add', [
      '=chain=forward',
      `=src-address=${ip}`,
      '=action=accept',
      '=comment=Static customer'
    ], { tenantId, serverId, timeoutMs: 10000 });
  } catch (err) {
    console.error('Failed to apply firewall rule for static IP', { err, tenantId, ip });
  }
}

module.exports = { applyStaticFirewall };
