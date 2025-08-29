// jobs/expireAccess.js
const cron = require('node-cron');
const RegisteredHotspotUser = require('../models/RegisteredHotspotUser');
const RegisteredPPPoEUser = require('../models/pppoeUsers');
const { connectToMikroTik } = require('../routes/mikrotikConnect');

let running = false; // simple lock to avoid overlapping runs

// Run every 5 minutes (Kenya time)
cron.schedule('*/5 * * * *', async () => {
  if (running) {
    console.warn('⏳ Expiry job skipped: previous run still in progress');
    return;
  }
  running = true;

  const startedAt = new Date();
  const stamp = startedAt.toISOString();
  console.log(`⏰ [${stamp}] Running expiry check...`);

  let api = null;

  try {
    const now = new Date();

    // Fetch only what we need; lean for speed
    const [expiredHotspotUsers, expiredPPPoEUsers] = await Promise.all([
      RegisteredHotspotUser.find({ expiresAt: { $lt: now } })
        .select('_id mac') // assuming hotspot name == MAC in ROS
        .lean(),
      RegisteredPPPoEUser.find({ expiresAt: { $lt: now } })
        .select('_id username') // assuming PPPoE secret name == username
        .lean(),
    ]);

    const totalExpired =
      expiredHotspotUsers.length + expiredPPPoEUsers.length;

    if (totalExpired === 0) {
      console.log('✅ No expired users found');
      return;
    }

    // Connect only if we actually have work
    api = await connectToMikroTik();
    if (!api) {
      console.error('⚠️ Could not connect to MikroTik for expiry job');
      return;
    }

    // ----------- Hotspot removals -----------
    if (expiredHotspotUsers.length) {
      console.log(`🔥 Expiring ${expiredHotspotUsers.length} Hotspot user(s)`);

      for (const user of expiredHotspotUsers) {
        try {
          // Find hotspot user by name (you use MAC as the name)
          const list = await api.write('/ip/hotspot/user/print', [`?name=${user.mac}`]);

          if (Array.isArray(list) && list.length > 0) {
            // Remove the first matching entry (.id is RouterOS internal id)
            await api.write('/ip/hotspot/user/remove', [`=.id=${list[0]['.id']}`]);
            console.log(`✅ Removed Hotspot user: ${user.mac}`);
          } else {
            console.log(`ℹ️ Hotspot user not found on router: ${user.mac}`);
          }

          await RegisteredHotspotUser.deleteOne({ _id: user._id });
        } catch (err) {
          console.error(`❌ Error expiring Hotspot user ${user.mac}:`, err?.message || err);
          // do not throw; continue others
        }
      }
    }

    // ----------- PPPoE removals -----------
    if (expiredPPPoEUsers.length) {
      console.log(`🔥 Expiring ${expiredPPPoEUsers.length} PPPoE user(s)`);

      for (const user of expiredPPPoEUsers) {
        try {
          const list = await api.write('/ppp/secret/print', [`?name=${user.username}`]);

          if (Array.isArray(list) && list.length > 0) {
            await api.write('/ppp/secret/remove', [`=.id=${list[0]['.id']}`]);
            console.log(`✅ Removed PPPoE user: ${user.username}`);
          } else {
            console.log(`ℹ️ PPPoE secret not found on router: ${user.username}`);
          }

          await RegisteredPPPoEUser.deleteOne({ _id: user._id });
        } catch (err) {
          console.error(`❌ Error expiring PPPoE user ${user.username}:`, err?.message || err);
          // continue others
        }
      }
    }

    console.log(`🏁 Expiry job finished in ${Math.round((Date.now() - startedAt.getTime()) / 1000)}s (processed: ${totalExpired})`);
  } catch (err) {
    console.error('⚠️ Unified expiry cron job failed:', err?.message || err);
  } finally {
    try {
      if (api?.close) await api.close();
    } catch (e) {
      console.error('⚠️ Error closing MikroTik API connection:', e?.message || e);
    }
    running = false;
  }
});

console.log('⏳ Expiry job scheduled (every 5 minutes)');
