// scripts/migrate-plan-duration.js
const mongoose = require('mongoose');
const Plan = require('../models/plan'); // after replacing schema above

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    const plans = await Plan.find().lean(false); // get docs
    for (const p of plans) {
      // If already migrated, skip
      if (Number.isFinite(p.durationDays) && p.durationDays > 0) continue;

      // Try to read legacy field “duration”
      const legacy = p.duration ?? p._doc?.duration; // tolerate old field
      if (legacy == null) {
        console.log('Skip (no legacy duration):', p._id, p.name);
        continue;
      }

      // Use the schema’s hook by setting .duration on doc then save
      p.duration = legacy;
      await p.save();
      console.log('Migrated:', p._id, p.name, '→', p.durationDays, 'days');
    }

    console.log('Done.');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
