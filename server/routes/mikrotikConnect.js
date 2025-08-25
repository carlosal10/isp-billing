const express = require('express');
const router = express.Router();
const {
  connectToMikrotik,
  disconnectMikrotik
} = require('../../utils/mikrotikConnectionManager'); // ✅ fix path

router.post('/', async (req, res) => {
  const { host, user, password } = req.body;

  if (!host || !user || !password) {
    return res.status(400).json({ success: false, message: 'All fields are required' });
  }

  try {
    const client = await connectToMikrotik({ host, user, password });

    const identity = await client.write('/system/identity/print');
    const routerName = identity[0]?.name || 'Unknown';

    return res.status(200).json({
      success: true,
      message: `✅ Connected to MikroTik: ${routerName}`,
      router: identity
    });

  } catch (error) {
    console.error('❌ Connection error:', error.message);

    let errorType = 'Unknown error';
    const msg = error.message.toLowerCase();

    if (msg.includes('timeout') || error.code === 'ETIMEDOUT') {
      errorType = 'Connection timed out. Router may be unreachable or blocked.';
    } else if (msg.includes('refused')) {
      errorType = 'Connection refused. Router API port may be closed or filtered.';
    } else if (msg.includes('login failure')) {
      errorType = 'Invalid username or password.';
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to connect to MikroTik',
      error: errorType
    });
  }
});

module.exports = router;
