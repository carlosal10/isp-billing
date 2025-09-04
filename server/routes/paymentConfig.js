// paymentConfig.js (tenant-scoped)
const express = require('express');
const router = express.Router();
const PaymentConfig = require('../models/PaymentConfig');

// Save or update settings for a provider (tenant inferred from req.tenantId)
router.post('/:provider', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const provider = String(req.params.provider || '').toLowerCase();
    const settings = req.body || {};

    if (!tenantId || !provider) {
      return res.status(400).json({ error: 'Missing tenant or provider' });
    }

    const ispId = String(tenantId);
    const existing = await PaymentConfig.findOne({ ispId, provider });
    if (existing) {
      Object.assign(existing, settings);
      await existing.save();
      return res.json({ ok: true, message: `${provider} settings updated`, provider });
    }
    await PaymentConfig.create({ ispId, provider, ...settings });
    return res.json({ ok: true, message: `${provider} settings saved`, provider });
  } catch (err) {
    console.error('Payment config save error:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Load settings for a specific provider (tenant inferred)
router.get('/:provider', async (req, res) => {
  try {
    const ispId = String(req.tenantId);
    const provider = String(req.params.provider || '').toLowerCase();
    const config = await PaymentConfig.findOne({ ispId, provider }).lean();
    res.json(config || {});
  } catch (err) {
    console.error('Payment config load error:', err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

module.exports = router;
