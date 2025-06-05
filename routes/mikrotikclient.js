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
    timeout: 10000,
  });

  try {
    await mikrotikClient.connect();

    const identity = await mikrotikClient.write('/system/identity/print');
    const routerName = identity?.[0]?.name || ip;

    res.status(200).json({
      message: `Successfully connected to router: ${routerName}`,
      identity: identity[0],
    });
  } catch (error) {
    console.error('MikroTik connection error:', error);
    res.status(500).json({
      message: 'Failed to connect to MikroTik',
      error: error.message || 'Unknown error',
    });
  } finally {
    try {
      await mikrotikClient.close();
    } catch (closeError) {
      console.warn('Failed to close MikroTik connection:', closeError.message);
    }
  }
});

module.exports = router;
