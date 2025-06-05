const express = require('express');
const { RouterOSAPI } = require('routeros-client');
const router = express.Router();

router.post('/connect', async (req, res) => {
  const { ip, username, password } = req.body;

  if (!ip || !username || !password) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  const mikrotikClient = new RouterOSAPI({
    host: ip,
    user: username,
    password: password,
    port: 8728,
    timeout: 5000
  });

  try {
    await mikrotikClient.connect();
    const identity = await mikrotikClient.write('/system/identity/print');
    mikrotikClient.close();

    return res.status(200).json({
      success: true,
      message: `Connected to ${identity[0]['name']}`,
      identity: identity[0]
    });
  } catch (err) {
    console.error('[MikroTik Error]:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to connect to MikroTik',
      error: err.message
    });
  }
});

module.exports = router;
