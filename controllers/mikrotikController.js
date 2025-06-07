const MikroTikAPI = require('mikrotik-api'); // or your preferred lib
const { getRouterConfig } = require('../utils/routerConfig'); // e.g., from DB

// Fetch Hotspot Servers
exports.getHotspotServers = async (req, res) => {
  try {
    const router = await getRouterConfig(); // { host, user, password }
    const conn = MikroTikAPI(router);

    await conn.connect();

    const servers = await conn.write('/ip/hotspot/print');
    const parsed = servers.map(item => ({
      name: item.name,
      interface: item.interface
    }));

    await conn.close();
    res.json(parsed);
  } catch (err) {
    console.error('Error fetching hotspot servers:', err);
    res.status(500).json({ error: 'Failed to fetch hotspot servers' });
  }
};

// Fetch Hotspot User Profiles
exports.getHotspotProfiles = async (req, res) => {
  try {
    const router = await getRouterConfig();
    const conn = MikroTikAPI(router);

    await conn.connect();

    const profiles = await conn.write('/ip/hotspot/user/profile/print');
    const parsed = profiles.map(p => ({
      name: p.name,
      rateLimit: p['rate-limit'],
      sharedUsers: p['shared-users']
    }));

    await conn.close();
    res.json(parsed);
  } catch (err) {
    console.error('Error fetching hotspot profiles:', err);
    res.status(500).json({ error: 'Failed to fetch hotspot profiles' });
  }
};
