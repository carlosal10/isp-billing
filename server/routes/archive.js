const express = require('express');
const router = express.Router();
const Payment = require('../models/Payment');
const PaymentArchive = require('../models/PaymentArchive');

// POST /api/admin/archive/payments?days=90 (tenant-scoped)
router.post('/admin/archive/payments', async (req, res) => {
  try {
    const days = Math.max(1, Number(req.query.days) || 90);
    const cutoff = new Date(Date.now() - days * 86400000);
    const filter = { tenantId: req.tenantId, createdAt: { $lt: cutoff }, isDeleted: { $ne: true } };
    const olds = await Payment.find(filter).limit(1000).lean();
    if (olds.length === 0) return res.json({ ok: true, archived: 0 });
    const docs = olds.map(p => ({ tenantId: p.tenantId, originalId: p._id, data: p, archivedAt: new Date() }));
    await PaymentArchive.insertMany(docs, { ordered: false });
    // Soft-delete payments after archiving
    const ids = olds.map(p => p._id);
    await Payment.updateMany({ _id: { $in: ids } }, { $set: { isDeleted: true, deletedAt: new Date(), deleteReason: 'archived' } });
    res.json({ ok: true, archived: olds.length });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'Archive failed' });
  }
});

module.exports = router;

