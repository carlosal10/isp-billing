//mpesaConfig.js
const express = require('express');
const router = express.Router();
const PaymentConfig = require('../models/PaymentConfig');

// Save or update payment integration settings
router.post('/save', async (req, res) => {
  const { ispId, provider, settings } = req.body;

  if (!ispId || !provider || !settings) {
    return res.status(400).json({ error: 'ISP ID, provider, and settings are required.' });
  }

  try {
    const existing = await PaymentConfig.findOne({ ispId, provider });
    if (existing) {
      Object.assign(existing, settings);
      await existing.save();
      return res.json({ message: `${provider} settings updated successfully.` });
    }

    await PaymentConfig.create({ ispId, provider, ...settings });
    res.json({ message: `${provider} settings saved successfully.` });
  } catch (err) {
    console.error(`${provider} config error:`, err);
    res.status(500).json({ error: `Failed to save ${provider} settings.` });
  }
});

// Load settings for a specific provider
router.get('/:ispId/:provider', async (req, res) => {
  try {
    const config = await PaymentConfig.findOne({
      ispId: req.params.ispId,
      provider: req.params.provider,
    });
    res.json(config || {});
  } catch (err) {
    console.error('Failed to load payment settings:', err);
    res.status(500).json({ error: 'Failed to load settings.' });
  }
});

module.exports = router;
