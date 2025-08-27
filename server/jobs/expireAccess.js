// jobs/expireAccess.js
const cron = require('node-cron');
const RegisteredHotspotUser = require('../models/RegisteredHotspotUser');
const RegisteredPPPoEUser = require('../models/pppoeUsers');
const { connectToMikroTik } = require('../routes/mikrotikConnect');

console.log('⏳ Expiry job scheduled (every 5 minutes)');
// Runs every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  const now = new Date();
  console.log('⏰ Running expiry check...');

  try {
    // Fetch expired users in parallel
    const [expiredHotspotUsers, expiredPPPoEUsers] = await Promise.all([
      RegisteredHotspotUser.find({ expiresAt: { $lt: now } }),
      RegisteredPPPoEUser.find({ expiresAt: { $lt: now } })
    ]);

    if (!expiredHotspotUsers.length && !expiredPPPoEUsers.length) return;

    const api = await connectToMikroTik();
    if (!api) {
      console.error('⚠️ Could not connect to MikroTik for expiry job');
      return;
    }

    // 🔥 Handle expired Hotspot users
    for (const user of expiredHotspotUsers) {
      try {
        const hotspotUsers = await api.write('/ip/hotspot/user/print', [`?name=${user.mac}`]);

        if (hotspotUsers.length) {
          await api.write('/ip/hotspot/user/remove', [`=.id=${hotspotUsers[0]['.id']}`]);
          console.log(`🔥 Expired and removed Hotspot user (MAC): ${user.mac}`);
        }

        await RegisteredHotspotUser.deleteOne({ _id: user._id });
      } catch (err) {
        console.error(`❌ Error expiring Hotspot user ${user.mac}:`, err.message);
      }
    }

    // 🔥 Handle expired PPPoE users
    for (const user of expiredPPPoEUsers) {
      try {
        const pppSecrets = await api.write('/ppp/secret/print', [`?name=${user.username}`]);

        if (pppSecrets.length) {
          await api.write('/ppp/secret/remove', [`=.id=${pppSecrets[0]['.id']}`]);
          console.log(`🔥 Expired and removed PPPoE user: ${user.username}`);
        }

        await RegisteredPPPoEUser.deleteOne({ _id: user._id });
      } catch (err) {
        console.error(`❌ Error expiring PPPoE user ${user.username}:`, err.message);
      }
    }

    try {
      await api.close();
    } catch (err) {
      console.error('⚠️ Error closing MikroTik API connection:', err.message);
    }
  } catch (err) {
    console.error('⚠️ Unified expiry cron job failed:', err.message);
  }
});
