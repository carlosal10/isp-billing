const express = require('express');
const { RouterOSAPI } = require('routeros-client');
const router = express.Router();

router.post('/', async (req, res) => {
  const { ip, username, password } = req.body;

  if (!ip || !username || !password) {
    return res.status(400).json({ success: false, message: 'All fields are required' });
  }

  const mikrotikClient = new RouterOSAPI({
    host: ip,
    user: username,
    password: password,
    port: 8728,
    timeout: 30000
  });

  try {
    await mikrotikClient.connect();
    const identity = await mikrotikClient.write('/system/identity/print');
    mikrotikClient.close();

    if (!identity || identity.length === 0 || !identity[0].name) {
      return res.status(500).json({ success: false, message: 'Connected but failed to read identity' });
    }

    res.status(200).json({
      success: true,
      message: `Connected to ${identity[0].name}`,
      router: identity
    });

  } catch (error) {
    console.error('💥 Connect Error (full):', error);
    res.status(500).json({
      success: false,
      message: 'Failed to connect to MikroTik',
      error: error.message || 'Unknown error'
    });
  }
});

module.exports = router;
