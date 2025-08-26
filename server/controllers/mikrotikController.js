// mikrotikController.js
const { call } = require('../utils/mikrotikConnectionManager');

// ---------------- HOTSPOT CONTROLLERS ---------------- //

// GET /api/hotspot/servers
exports.getHotspotServers = async (req, res) => {
  try {
    const servers = await call('/ip/hotspot/print');
    if (!servers || servers.length === 0) {
      return res.status(404).json({ message: 'No hotspot servers found' });
    }
    res.json({ message: 'Hotspot servers fetched', servers });
  } catch (err) {
    console.error('Error fetching hotspot servers:', err.message);
    res.status(500).json({ message: 'Failed to fetch hotspot servers' });
  }
};

// GET /api/hotspot/profiles
exports.getHotspotProfiles = async (req, res) => {
  try {
    const profiles = await call('/ip/hotspot/user/profile/print');
    if (!profiles || profiles.length === 0) {
      return res.status(404).json({ message: 'No hotspot profiles found' });
    }
    res.json({ message: 'Hotspot profiles fetched', profiles });
  } catch (err) {
    console.error('Error fetching hotspot profiles:', err.message);
    res.status(500).json({ message: 'Failed to fetch hotspot profiles' });
  }
};

// GET /api/hotspot/users
exports.getHotspotUsers = async (req, res) => {
  try {
    const users = await call('/ip/hotspot/user/print');
    res.json({ message: 'Hotspot users fetched', users });
  } catch (err) {
    console.error('Error fetching hotspot users:', err.message);
    res.status(500).json({ message: 'Failed to fetch hotspot users' });
  }
};

// ---------------- FUTURE EXTENSIONS ---------------- //
// Example: add/remove hotspot user, enable/disable server, etc.

