const express = require('express');
const router = express.Router();
const { createPayLink } = require('../utils/paylink');

// Protected: create a tokenized paylink for a customer/plan
// Body: { customerId, planId, dueAt? }
router.post('/create', async (req, res) => {
  try {
    const { customerId, planId, dueAt } = req.body || {};
    if (!customerId || !planId) return res.status(400).json({ error: 'Missing customerId or planId' });
    const { token, url, shortUrl, shortPath, expiresIn } = await createPayLink({ tenantId: req.tenantId, customerId, planId, dueAt });
    res.json({ token, url, shortUrl, shortPath, expiresIn });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to create paylink' });
  }
});

module.exports = router;
