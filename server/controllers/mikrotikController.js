// mikrotikController.js
const { RouterOSAPI } = require('node-routeros');
const { getRouterConfig } = require('../routes/mikrotikConnect.js'); // loads router creds

// Generic function to connect and fetch data
async function connectAndFetch(path, params = {}) {
  const config = await getRouterConfig();
  const api = new RouterOSAPI({
    host: config.host,
    user: config.user,
    password: config.password,
    port: config.port
  });

  try {
    await api.connect();
    const response = await api.call(path, params);
    await api.close();
    return response;
  } catch (err) {
    console.error('MikroTik API Error:', err.message);
    throw new Error('Failed to connect to MikroTik');
  }
}

// GET /api/hotspot/servers
exports.getHotspotServers = async (req, res) => {
  try {
    const servers = await connectAndFetch('/ip/hotspot/print');
    res.json(servers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/hotspot/profiles
exports.getHotspotProfiles = async (req, res) => {
  try {
    const profiles = await connectAndFetch('/ip/hotspot/user/profile/print');
    res.json(profiles);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
