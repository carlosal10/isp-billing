const express = require('express');
const router = express.Router();
const Flag = require('../models/Flag');

router.get('/', async (req, res) => {
  const rows = await Flag.find({ tenantId: req.tenantId }).lean();
  res.json(rows);
});

router.post('/', async (req, res) => {
  try {
    const { key, enabled, description, rollout } = req.body || {};
    if (!key) return res.status(400).json({ error: 'key required' });
    const doc = await Flag.findOneAndUpdate(
      { tenantId: req.tenantId, key: String(key) },
      { $set: { enabled: !!enabled, description: description || '', rollout: Number(rollout ?? 100) } },
      { new: true, upsert: true }
    );
    res.status(201).json(doc);
  } catch (e) {
    res.status(500).json({ error: 'Failed to save flag' });
  }
});

router.delete('/:key', async (req, res) => {
  await Flag.deleteOne({ tenantId: req.tenantId, key: String(req.params.key) });
  res.json({ ok: true });
});

module.exports = router;

