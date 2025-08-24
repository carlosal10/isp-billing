// mikrotikConnectionManager.js
const { RouterOSAPI } = require('routeros-client');

let mikrotikClient = null;
let isConnected = false;
let config = null;

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

function getClient() {
  if (!mikrotikClient || !isConnected) {
    throw new Error('MikroTik is not connected. Call connectToMikrotik() first.');
  }
  return mikrotikClient;
}

async function reconnectIfNeeded() {
  if (!config) throw new Error('No MikroTik config found to reconnect.');
  if (!isConnected) return connectToMikrotik(config);
  return mikrotikClient;
}

function disconnectMikrotik() {
  if (mikrotikClient) {
    mikrotikClient.close();
    isConnected = false;
    mikrotikClient = null;
    console.log('🔌 Disconnected from MikroTik');
  }
}

module.exports = {
  connectToMikrotik,
  getClient,
  reconnectIfNeeded,
  disconnectMikrotik,
};
