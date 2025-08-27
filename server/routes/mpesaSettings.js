//mpesaSettings.js
const express = require('express');
const router = express.Router();
const MpesaSettings = require('../models/MpesaSettings');

// POST: Save M-Pesa settings
router.post('/settings', async (req, res) => {
  try {
    const { businessName, paybillShortcode, paybillPasskey, buyGoodsTill, buyGoodsPasskey } = req.body;

    const existing = await MpesaSettings.findOne({});
    if (existing) {
      existing.businessName = businessName;
      existing.paybillShortcode = paybillShortcode;
      existing.paybillPasskey = paybillPasskey;
      existing.buyGoodsTill = buyGoodsTill;
      existing.buyGoodsPasskey = buyGoodsPasskey;
      existing.updatedAt = new Date();
      await existing.save();
      return res.json({ success: true, message: 'Settings updated' });
    }

    await MpesaSettings.create({ businessName, paybillShortcode, paybillPasskey, buyGoodsTill, buyGoodsPasskey });
    res.json({ success: true, message: 'Settings saved' });
  } catch (err) {
    console.error('M-Pesa settings save error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET: Fetch current M-Pesa settings
router.get('/settings', async (req, res) => {
  try {
    const settings = await MpesaSettings.findOne({});
    if (!settings) return res.status(404).json({ success: false, message: 'Settings not found' });
    res.json({ success: true, settings });
  } catch (err) {
    console.error('M-Pesa settings fetch error:', err);
    res.status(500).json({ success: false, message: 'Could not fetch settings' });
  }
});

module.exports = router;
