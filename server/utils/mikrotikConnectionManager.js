// mikrotikConnectionManager.js
const { RouterOSAPI } = require('routeros-client');

let mikrotikClient = null;
let isConnected = false;
let config = null;
let lastStatus = 'disconnected';
let retryDelay = 2000; // initial retry 2s

/**
 * Connect to MikroTik
 */
async function connectToMikrotik(cfg) {
  if (mikrotikClient && isConnected) return mikrotikClient;

  config = cfg || config;
  if (!config) throw new Error('MikroTik config not provided');

  mikrotikClient = new RouterOSAPI({
    host: config.host,
    user: config.user,
    password: config.password,
    port: config.port || 8728,
    timeout: 30000,
  });

  try {
    await mikrotikClient.connect();
    isConnected = true;
    retryDelay = 2000; // reset backoff
    console.log(`✅ Connected to MikroTik at ${config.host}`);
    return mikrotikClient;
  } catch (err) {
    isConnected = false;
    mikrotikClient = null;
    console.error('❌ MikroTik connection failed:', err.message);
    throw new Error('MikroTikConnectionError: ' + err.message);
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
 * Try reconnecting with backoff
 */
async function reconnectIfNeeded() {
  if (!config) throw new Error('No MikroTik config found to reconnect.');
  if (!isConnected) {
    try {
      await connectToMikrotik(config);
    } catch (err) {
      console.warn(`⚠️ Reconnect failed, retrying in ${retryDelay / 1000}s`);
      setTimeout(reconnectIfNeeded, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 60000); // cap at 60s
      throw err;
    }
  }
  return mikrotikClient;
}

/**
 * Send command with auto-reconnect support
 */
async function sendCommand(command, params = []) {
  try {
    const client = await reconnectIfNeeded();
    return await client.write(command, params);
  } catch (err) {
    console.error(`❌ Failed to execute ${command}:`, err.message);
    throw new Error('MikroTikCommandError: ' + err.message);
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
 * Watchdog: keep connection alive
 */
setInterval(async () => {
  if (isConnected) {
    try {
      await sendCommand('/system/identity/print');
      if (lastStatus !== 'ok') {
        console.log('💓 MikroTik connection restored');
        lastStatus = 'ok';
      }
    } catch {
      if (lastStatus !== 'lost') {
        console.log('⚠️ Lost connection, attempting to reconnect...');
        lastStatus = 'lost';
      }
      try {
        await reconnectIfNeeded();
      } catch {}
    }
  }
}, 30000);

/**
 * Graceful shutdown
 */
process.on('SIGINT', disconnectMikrotik);
process.on('SIGTERM', disconnectMikrotik);

module.exports = {
  connectToMikrotik,
  getClient,
  reconnectIfNeeded,
  sendCommand,
  disconnectMikrotik,
};
