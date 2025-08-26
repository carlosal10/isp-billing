// mikrotikConnectionManager.js
const { RouterOSAPI } = require('routeros-client');

let mikrotikClient = null;
let isConnected = false;
let config = null;

/**
 * Connect to MikroTik
 */
async function connectToMikrotik({ host, user, password, port = 8728 }) {
  if (mikrotikClient && isConnected) return mikrotikClient;

  mikrotikClient = new RouterOSAPI({ host, user, password, port, timeout: 30000 });

  try {
    await mikrotikClient.connect();
    isConnected = true;
    config = { host, user, password, port };
    console.log(`✅ Connected to MikroTik at ${host}`);
    return mikrotikClient;
  } catch (err) {
    isConnected = false;
    mikrotikClient = null;
    console.error('❌ MikroTik connection failed:', err.message);
    throw err;
  }
}

/**
 * Get current client instance
 */
function getClient() {
  if (!mikrotikClient || !isConnected) {
    throw new Error('MikroTik is not connected. Call connectToMikrotik() first.');
  }
  return mikrotikClient;
}

/**
 * Try reconnecting if connection is lost
 */
async function reconnectIfNeeded() {
  if (!config) throw new Error('No MikroTik config found to reconnect.');
  if (!isConnected) return connectToMikrotik(config);
  return mikrotikClient;
}

/**
 * Send command with auto-reconnect support
 */
async function sendCommand(command, params = []) {
  try {
    const client = await reconnectIfNeeded();
    const result = await client.write(command, params);
    return result;
  } catch (err) {
    console.error(`❌ Failed to execute ${command}:`, err.message);
    throw err;
  }
}

/**
 * Disconnect MikroTik
 */
function disconnectMikrotik() {
  if (mikrotikClient) {
    mikrotikClient.close();
    isConnected = false;
    mikrotikClient = null;
    console.log('🔌 Disconnected from MikroTik');
  }
}

/**
 * Watchdog: keep connection alive with a heartbeat ping
 */
setInterval(async () => {
  if (isConnected) {
    try {
      await sendCommand('/system/identity/print');
      console.log('💓 MikroTik heartbeat OK');
    } catch (err) {
      console.log('⚠️ Lost connection, attempting to reconnect...');
      try {
        await reconnectIfNeeded();
      } catch (reErr) {
        console.error('❌ Reconnect failed:', reErr.message);
      }
    }
  }
}, 30000); // every 30s

module.exports = {
  connectToMikrotik,
  getClient,
  reconnectIfNeeded,
  sendCommand,
  disconnectMikrotik,
};
