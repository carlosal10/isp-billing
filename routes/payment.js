const express = require('express');
const router = express.Router();
const { initiateSTKPush } = require('../utils/mpesa');

// POST /api/payment/stk
router.post('/stk', async (req, res) => {
  const { ispId, amount, phone, accountReference } = req.body;

  if (!ispId || !amount || !phone) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const callbackURL = `https://yourdomain.com/api/payment/callback`; // adjust as needed
    const response = await initiateSTKPush({ ispId, amount, phone, accountReference, callbackURL });
    res.json(response);
  } catch (err) {
    console.error('STK Push Error:', err.message || err);
    res.status(500).json({ error: 'Failed to initiate STK Push' });
  }
});

module.exports = router;
