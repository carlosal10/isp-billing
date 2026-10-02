// mpesaSettings.js
const express = require('express');
const router = express.Router();
const PaymentConfig = require('../models/PaymentConfig');
const { getMpesaConfig } = require('../services/mpesaConfigurationService');
const requireRole = require('../middleware/requireRole');
const {
  sanitizePaymentConfigInput,
  serializePaymentConfig,
} = require('../services/configurationSanitizer');

router.use(requireRole('owner', 'admin'));


// --- config ---
const COMMON_FIELDS = ['businessName', 'environment', 'consumerKey', 'consumerSecret', 'payMethod'];
const GROUPS = {
  paybill: ['paybillShortcode', 'paybillPasskey'],
  buygoods: ['buyGoodsTill', 'buyGoodsPasskey'],
};
const DEFAULTS = { environment: 'sandbox', payMethod: 'paybill' };

function resolveTenant(req) {
  return req.tenantId ? String(req.tenantId) : null;
}

function sanitizeBody(body = {}) {
  // shallow pick of known keys only (drop anything unexpected)
  const allow = new Set([
    ...COMMON_FIELDS,
    ...GROUPS.paybill,
    ...GROUPS.buygoods,
  ]);
  const out = {};
  for (const k of Object.keys(body || {})) {
    if (allow.has(k)) out[k] = body[k];
  }
  return out;
}

function buildUpdateDoc(body = {}) {
  const b = sanitizePaymentConfigInput('mpesa', sanitizeBody(body));
  const payMethod = b.payMethod;
  const $set = { ...b };
  const $setOnInsert = { ...DEFAULTS };
  Object.keys($set).forEach((key) => delete $setOnInsert[key]);

  const $unset = {};
  if (payMethod) {
    const inactive = payMethod === 'paybill' ? GROUPS.buygoods : GROUPS.paybill;
    for (const k of inactive) { $unset[k] = ''; delete $set[k]; }
  }

  return { $set, $setOnInsert, ...(Object.keys($unset).length ? { $unset } : {}) };
}

// POST: upsert/save M-Pesa settings (only active fields persisted)
router.post('/settings', async (req, res) => {
  try {
    const ispId = resolveTenant(req);
    if (!ispId) return res.status(401).json({ success: false, message: 'Missing tenant context' });
    await getMpesaConfig(ispId);
    const filter = { ispId, provider: 'mpesa' };

    const update = buildUpdateDoc(req.body);
    update.$set.updatedAt = new Date();
    update.$set.ispId = ispId;

    const doc = await PaymentConfig.findOneAndUpdate(
      filter,
      update,
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    ).lean();

    return res.json({ success: true, message: 'Settings saved', settings: serializePaymentConfig({ ...doc, provider: 'mpesa' }, 'mpesa') });
  } catch (err) {
    console.error('M-Pesa settings save error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET: fetch current M-Pesa settings
router.get('/settings', async (req, res) => {
  try {
    const ispId = resolveTenant(req);
    if (!ispId) return res.status(401).json({ success: false, message: 'Missing tenant context' });
    const settings = (await getMpesaConfig(ispId))?.toObject();
    if (!settings) return res.status(404).json({ success: false, message: 'Settings not found' });
    res.json({ success: true, settings: serializePaymentConfig({ ...settings, provider: 'mpesa' }, 'mpesa') });
  } catch (err) {
    console.error('M-Pesa settings fetch error:', err);
    res.status(500).json({ success: false, message: 'Could not fetch settings' });
  }
});

module.exports = router;
