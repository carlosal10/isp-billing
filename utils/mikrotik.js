// utils/mikrotik.js
const { getClient } = require('../mikrotikConnectionManager');

async function addHotspotUser({ server, profile, username, password, macAddress }) {
  const client = await getClient();

  try {
    // Step 1: Add user to hotspot
    const userParams = [
      `=name=${username}`,
      `=password=${password}`,
      `=server=${server}`,
      `=profile=${profile}`
    ];

    if (macAddress) {
      userParams.push(`=mac-address=${macAddress}`);
    }

    await client.write('/ip/hotspot/user/add', userParams);

  } catch (err) {
    console.error('❌ Error adding hotspot user:', err.message);
    throw err;
  }
}

module.exports = { addHotspotUser };
