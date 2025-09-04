const express = require('express');
const bcrypt = require('bcrypt');
const User = require('../models/User');

const router = express.Router();

// GET /api/account/me - basic profile
router.get('/me', async (req, res) => {
  try {
    const u = await User.findById(req.user?.sub, { email: 1, displayName: 1, createdAt: 1 }).lean();
    if (!u) return res.status(404).json({ ok: false, error: 'User not found' });
    return res.json({ ok: true, user: { id: String(u._id), email: u.email, displayName: u.displayName, createdAt: u.createdAt } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Failed to load account' });
  }
});

// PUT /api/account/email - update email and/or display name
router.put('/email', async (req, res) => {
  try {
    const userId = req.user?.sub;
    const { email, displayName } = req.body || {};
    const update = {};
    if (typeof displayName === 'string' && displayName.trim()) update.displayName = String(displayName).trim();
    if (typeof email === 'string' && email.trim()) {
      const exists = await User.findOne({ email: String(email).trim(), _id: { $ne: userId } }).lean();
      if (exists) return res.status(409).json({ ok: false, error: 'Email already in use' });
      update.email = String(email).trim();
    }
    if (!Object.keys(update).length) return res.status(400).json({ ok: false, error: 'No changes' });
    await User.updateOne({ _id: userId }, { $set: update });
    return res.json({ ok: true, message: 'Profile updated' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Update failed' });
  }
});

// PUT /api/account/password - change password
router.put('/password', async (req, res) => {
  try {
    const userId = req.user?.sub;
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ ok: false, error: 'Missing fields' });
    const u = await User.findById(userId);
    if (!u) return res.status(404).json({ ok: false, error: 'User not found' });
    const ok = await bcrypt.compare(currentPassword, u.passwordHash);
    if (!ok) return res.status(401).json({ ok: false, error: 'Current password incorrect' });
    const hash = await bcrypt.hash(newPassword, 12);
    await User.updateOne({ _id: userId }, { $set: { passwordHash: hash } });
    return res.json({ ok: true, message: 'Password updated' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Password change failed' });
  }
});

module.exports = router;

