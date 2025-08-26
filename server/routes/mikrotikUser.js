const express = require('express');
const router = express.Router();
const { RouterOSAPI } = require('node-routeros');
const { getRouterConfig } = require('./mikrotikConnect');
const Plan = require('../models/plan');

// Generic helper to connect & run MikroTik commands
async function connectAndFetch(path, params = {}) {
  const config = await getRouterConfig();
  const api = new RouterOSAPI({
    host: config.host,
    user: config.user,
    password: config.password,
    port: config.port
  });

  try {
    await api.connect();
    const response = await api.call(path, params);
    await api.close();
    return response;
  } catch (err) {
    console.error('MikroTik API Error:', err.message);
    throw new Error('Failed to connect to MikroTik');
  }
}

// -----------------------------------------------
// GET /api/pppoe/profiles -> return DB plans
router.get('/profiles', async (req, res) => {
  try {
    const plans = await Plan.find({});
    if (!plans || plans.length === 0) {
      return res.status(404).json({ message: 'No plans found' });
    }

    const profiles = plans.map(plan => ({
      id: plan._id,
      name: plan.name,
      price: plan.price,
      duration: plan.duration
    }));

    res.status(200).json({ message: 'Profiles loaded', profiles });
  } catch (error) {
    console.error('Error fetching profiles:', error);
    res.status(500).json({ message: 'Failed to fetch profiles' });
  }
});

// -----------------------------------------------
// POST /api/pppoe -> Create PPPoE user
router.post('/', async (req, res) => {
  const { username, password, profile } = req.body;

  if (!username || !password || !profile) {
    return res.status(400).json({ message: 'Username, password, and profile are required' });
  }

  try {
    const result = await connectAndFetch('/ppp/secret/add', {
      name: username,
      password,
      service: 'pppoe',
      profile
    });

    res.status(201).json({ message: 'User added successfully', result });
  } catch (error) {
    console.error('Error adding user:', error);
    res.status(500).json({ message: 'Failed to add user to MikroTik' });
  }
});

// -----------------------------------------------
// DELETE /api/pppoe/remove/:username
router.delete('/remove/:username', async (req, res) => {
  const { username } = req.params;

  try {
    const users = await connectAndFetch('/ppp/secret/print', { '.query': `name=${username}` });

    if (!users.length) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userId = users[0]['.id'];

    const result = await connectAndFetch('/ppp/secret/remove', { '.id': userId });

    res.status(200).json({ message: 'User removed successfully', result });
  } catch (error) {
    console.error('Error removing user:', error);
    res.status(500).json({ message: 'Failed to remove user from MikroTik' });
  }
});

// -----------------------------------------------
// PUT /api/pppoe/update/:username -> update password
router.put('/update/:username', async (req, res) => {
  const { username } = req.params;
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ message: 'New password is required' });
  }

  try {
    const users = await connectAndFetch('/ppp/secret/print', { '.query': `name=${username}` });

    if (!users.length) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userId = users[0]['.id'];

    const result = await connectAndFetch('/ppp/secret/set', { '.id': userId, password });

    res.status(200).json({ message: 'Password updated successfully', result });
  } catch (error) {
    console.error('Error updating password:', error);
    res.status(500).json({ message: 'Failed to update password' });
  }
});

// -----------------------------------------------
// GET /api/pppoe/list -> all PPPoE users
router.get('/list', async (req, res) => {
  try {
    const result = await connectAndFetch('/ppp/secret/print');
    res.status(200).json({ message: 'PPPoE users fetched successfully', users: result });
  } catch (error) {
    console.error('Error fetching PPPoE users:', error);
    res.status(500).json({ message: 'Failed to fetch PPPoE users from MikroTik' });
  }
});

// -----------------------------------------------
// GET /api/pppoe/online -> active sessions
router.get('/online', async (req, res) => {
  try {
    const result = await connectAndFetch('/ppp/active/print');
    res.status(200).json({ message: 'Online users fetched', users: result });
  } catch (error) {
    console.error('Error fetching online users:', error);
    res.status(500).json({ message: 'Failed to fetch online PPPoE users' });
  }
});

module.exports = router;
