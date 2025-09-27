// mpesaSettings.js
const express = require('express');
const router = express.Router();
const MpesaSettings = require('../models/MpesaSettings'); // see schema note below


// --- config ---
const COMMON_FIELDS = ['businessName', 'environment', 'consumerKey', 'consumerSecret', 'payMethod'];
const GROUPS = {
  paybill: ['paybillShortcode', 'paybillPasskey'],
  buygoods: ['buyGoodsTill', 'buyGoodsPasskey'],
};
const DEFAULTS = { environment: 'sandbox', payMethod: 'paybill' };

function resolveTenant(req) {
  // If you have auth middleware, prefer req.user.ispId
  return req.query.ispId || req.user?.ispId || null; // null -> single-tenant
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
  const b = sanitizeBody(body);
  const payMethod = b.payMethod === 'buygoods' ? 'buygoods' : 'paybill';

  const $set = {
    ...DEFAULTS,
    ...Object.fromEntries(COMMON_FIELDS.filter(k => b[k] != null).map(k => [k, b[k]])),
  };

  // set only active group fields that are present in body
  const activeKeys = new Set(GROUPS[payMethod]);
  for (const k of GROUPS[payMethod]) {
    if (b[k] != null && b[k] !== '') $set[k] = b[k];
  }

  // unset stale keys from the inactive group
  const inactive = payMethod === 'paybill' ? GROUPS.buygoods : GROUPS.paybill;
  const $unset = {};
  for (const k of inactive) $unset[k] = '';

  return { $set, $unset };
}

// POST: upsert/save M-Pesa settings (only active fields persisted)
router.post('/settings', async (req, res) => {
  try {
    const ispId = resolveTenant(req);
    const filter = ispId ? { ispId } : {}; // single-tenant if no ispId

    const update = buildUpdateDoc(req.body);
    update.$set.updatedAt = new Date();
    if (ispId) update.$set.ispId = ispId;

    const doc = await MpesaSettings.findOneAndUpdate(
      filter,
      update,
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    // Optional: return only active fields to the client
    return res.json({ success: true, message: 'Settings saved', settings: doc });
  } catch (err) {
    console.error('M-Pesa settings save error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET: fetch current M-Pesa settings
router.get('/settings', async (req, res) => {
  try {
    const ispId = resolveTenant(req);
    const filter = ispId ? { ispId } : {};
    const settings = await MpesaSettings.findOne(filter).lean();
    if (!settings) return res.status(404).json({ success: false, message: 'Settings not found' });
    res.json({ success: true, settings });
  } catch (err) {
    console.error('M-Pesa settings fetch error:', err);
    res.status(500).json({ success: false, message: 'Could not fetch settings' });
  }
});

module.exports = router;
