const express = require('express');
const router = express.Router();
const Plan = require('../models/plan');
const { sendCommand } = require('../utils/mikrotikConnectionManager');


// GET profiles from DB
router.get('/profiles', async (req, res) => {
  try {
    const plans = await Plan.find({});
    if (!plans.length) {
      return res.status(404).json({ message: 'No plans found' });
    }

    const profiles = plans.map(plan => ({
      id: plan._id,
      name: plan.name,
      price: plan.price,
      duration: plan.duration,
    }));

    res.json({ message: 'Profiles loaded', profiles });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch profiles' });
  }
});

// Add user
router.post('/', async (req, res) => {
  const { username, password, profile } = req.body;
  if (!username || !password || !profile) {
    return res.status(400).json({ message: 'All fields required' });
  }

  try {
    const result = await sendCommand('/ppp/secret/add', {
      name: username,
      password,
      service: 'pppoe',
      profile,
    });
    res.status(201).json({ message: 'User added successfully', result });
  } catch (err) {
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
