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

    let errorType = 'Unknown error';

    if (error.message.includes('timeout') || error.errno === -110) {
      errorType = 'Connection timed out. Router may be unreachable or blocked.';
    } else if (error.message.includes('ECONNREFUSED')) {
      errorType = 'Connection refused. Router API port may be closed or filtered.';
    } else if (error.message.toLowerCase().includes('login failure')) {
      errorType = 'Invalid username or password.';
    } else if (error.code === 'ETIMEDOUT') {
      errorType = 'Timeout error. Router might be offline or unreachable.';
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to connect to MikroTik',
      error: errorType
    });
  }
});

module.exports = router;
