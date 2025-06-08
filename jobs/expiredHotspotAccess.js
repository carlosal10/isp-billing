// jobs/expireHotspotAccess.js
const cron = require('node-cron');
const RegisteredHotspotUser = require('../models/RegisteredHotspotUser');
const { connectToMikroTik } = require('../routes/mikrotikConnect'); // use shared connection

// Runs every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  try {
    const now = new Date();

    // Find expired users
    const expiredUsers = await RegisteredHotspotUser.find({ expiresAt: { $lt: now } });

    if (!expiredUsers.length) return;

    const api = await connectToMikroTik();

    for (const user of expiredUsers) {
      try {
        // Remove user from MikroTik hotspot
        const hotspotUsers = await api.write('/ip/hotspot/user/print', [`?name=${user.mac}`]);

        if (hotspotUsers.length) {
          await api.write('/ip/hotspot/user/remove', [`=.id=${hotspotUsers[0]['.id']}`]);
        }

        // Optional: delete or mark as expired
        await RegisteredHotspotUser.deleteOne({ _id: user._id });

        console.log(`🔥 Expired and removed MAC: ${user.mac}`);
      } catch (err) {
        console.error(`❌ Error expiring user ${user.mac}:`, err.message);
      }
    }

    await api.close();
  } catch (err) {
    console.error('⚠️ Expiry cron job failed:', err.message);
  }
});
