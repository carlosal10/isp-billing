const express = require('express');
const router = express.Router();
const Plan = require('../models/plan');
const { sendCommand } = require('../utils/mikrotikConnectionManager');


// ✅ Get profiles directly from MikroTik
router.get('/profiles', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const profiles = await sendCommand('/ppp/profile/print', [], { tenantId, timeoutMs: 10000 });

    const formatted = (Array.isArray(profiles) ? profiles : []).map((p, index) => ({
      id: p['.id'] || p.id || index,
      name: p.name,
      localAddress: p['local-address'] || p.localAddress || null,
      rateLimit: p['rate-limit'] || p.rateLimit || null,
    }));

    return res.json({ message: 'Profiles loaded from MikroTik', profiles: formatted });
  } catch (err) {
    console.error("Error fetching MikroTik profiles:", err?.message || err);
    // Degrade gracefully so clients can handle empty state without throwing
    return res.json({ message: 'No PPPoE profiles available', profiles: [], error: String(err?.message || err) });
  }
});

// Add user
router.post('/', async (req, res) => {
  const { username, password, profile } = req.body;

  if (!username || !password || !profile) {
    return res.status(400).json({ message: 'All fields required' });
  }

  try {
    const args = [
      `=name=${username}`,
      `=password=${password}`,
      `=service=pppoe`,
      `=profile=${profile}`,
    ];

    const result = await sendCommand('/ppp/secret/add', args);

    res.status(201).json({ message: 'User added successfully', result });
  } catch (err) {
    console.error("Error adding PPPoE user:", err);
    res.status(500).json({ message: err.message });
  }
});
// Remove user
router.delete('/remove/:username', async (req, res) => {
  try {
    const users = await sendCommand('/ppp/secret/print', { name: req.params.username });
    if (!users.length) return res.status(404).json({ message: 'User not found' });

    const result = await sendCommand('/ppp/secret/remove', { '.id': users[0]['.id'] });
    res.json({ message: 'User removed', result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update password
router.put('/update/:username', async (req, res) => {
  if (!req.body.password) {
    return res.status(400).json({ message: 'Password required' });
  }

  try {
    const users = await sendCommand('/ppp/secret/print', { name: req.params.username });
    if (!users.length) return res.status(404).json({ message: 'User not found' });

    const result = await sendCommand('/ppp/secret/set', { '.id': users[0]['.id'], password: req.body.password });
    res.json({ message: 'Password updated', result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// List users
router.get('/list', async (req, res) => {
  try {
    const result = await sendCommand('/ppp/secret/print');
    res.json({ message: 'PPPoE users fetched', users: result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Online users
router.get('/online', async (req, res) => {
  try {
    const result = await call('/ppp/active/print');
    res.json({ message: 'Online users fetched', users: result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
