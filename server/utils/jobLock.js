const JobLock = require('../models/JobLock');

async function acquireLock(name, ttlMs = 4 * 60 * 1000) {
  const now = new Date();
  const until = new Date(Date.now() + ttlMs);
  try {
    const filter = {
      name,
      $or: [
        { lockedUntil: { $exists: false } },
        { lockedUntil: { $lt: now } },
      ],
    };
    const update = {
      $set: { lockedAt: now, lockedUntil: until, holder: process.pid ? String(process.pid) : null },
      $setOnInsert: { name },
    };
    const opts = { upsert: true, returnDocument: 'after' };
    const doc = await JobLock.findOneAndUpdate(filter, update, opts).exec();
    if (!doc) return false;
    // if doc.lockedUntil equals until, we acquired; otherwise not
    if (doc.lockedUntil && doc.lockedUntil.getTime() === until.getTime()) return true;
    return false;
  } catch (err) {
    // possible duplicate key error if upsert raced; treat as lock not acquired
    return false;
  }
}

async function releaseLock(name) {
  try {
    await JobLock.deleteOne({ name }).exec();
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = { acquireLock, releaseLock };
