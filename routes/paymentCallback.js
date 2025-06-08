// routes/paymentCallback.js
const express = require('express');
const router = express.Router();

// POST /api/payment/callback
router.post('/callback', (req, res) => {
  const body = req.body;

  console.log('📩 M-Pesa Callback:', JSON.stringify(body, null, 2));

  // Save to DB, mark access as granted, or trigger logic
  // Example: match by accountReference or phone

  res.json({ ResultCode: 0, ResultDesc: 'Success' }); // always respond with this
});

module.exports = router;
