// paymentConfig.js (tenant-scoped)
const express = require('express');
const router = express.Router();
const PaymentConfig = require('../models/PaymentConfig');
const requireRole = require('../middleware/requireRole');
const {
  normalizePaymentProvider,
  sanitizePaymentConfigInput,
  serializePaymentConfig,
} = require('../services/configurationSanitizer');

router.use(requireRole('owner', 'admin'));

// Save or update settings for a provider (tenant inferred from req.tenantId)
router.post('/:provider', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const provider = normalizePaymentProvider(req.params.provider);

    if (!tenantId || !provider) {
      return res.status(400).json({ error: 'Missing tenant or unsupported provider' });
    }

    const ispId = String(tenantId);
    const settings = sanitizePaymentConfigInput(provider, req.body || {});
    const existing = await PaymentConfig.findOne({ ispId, provider });
    if (existing) {
      Object.assign(existing, settings);
      await existing.save();
      return res.json({ ok: true, message: `${provider} settings updated`, settings: serializePaymentConfig(existing, provider) });
    }
    const created = await PaymentConfig.create({ ...settings, ispId, provider });
    return res.json({ ok: true, message: `${provider} settings saved`, settings: serializePaymentConfig(created, provider) });
  } catch (err) {
    console.error('Payment config save error:', err);
    res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to save settings' });
  }
});

// Load settings for a specific provider (tenant inferred)
router.get('/:provider', async (req, res) => {
  try {
    if (!req.tenantId) return res.status(401).json({ error: 'Missing tenant context' });
    const ispId = String(req.tenantId);
    const provider = normalizePaymentProvider(req.params.provider);
    if (!provider) return res.status(400).json({ error: 'Unsupported payment provider' });
    const config = await PaymentConfig.findOne({ ispId, provider }).lean();
    res.json(serializePaymentConfig(config, provider));
  } catch (err) {
    console.error('Payment config load error:', err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

module.exports = router;
