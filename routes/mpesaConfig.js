// routes/mpesaConfig.js
const express = require('express');
const router = express.Router();
const MpesaConfig = require('../models/MpesaConfig');

router.post('/save', async (req, res) => {
  const { ispId, payMethod, shortCode, passkey, consumerKey, consumerSecret } = req.body;

  try {
    const existing = await MpesaConfig.findOne({ ispId });
    if (existing) {
      Object.assign(existing, { payMethod, shortCode, passkey, consumerKey, consumerSecret });
      await existing.save();
      return res.json({ message: 'M-Pesa settings updated successfully.' });
    }

    await MpesaConfig.create({ ispId, payMethod, shortCode, passkey, consumerKey, consumerSecret });
    res.json({ message: 'M-Pesa settings saved successfully.' });
  } catch (err) {
    console.error('M-Pesa config error:', err);
    res.status(500).json({ error: 'Failed to save settings.' });
  }
});

router.get('/:ispId', async (req, res) => {
  try {
    const config = await MpesaConfig.findOne({ ispId: req.params.ispId });
    res.json(config || {});
  } catch {
    res.status(500).json({ error: 'Failed to load settings.' });
  }
});

module.exports = router;
