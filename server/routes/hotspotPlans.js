const express = require('express');
const router = express.Router();
const HotspotPlan = require('../models/HotspotPlan');

// Map request payload (UI shape) -> model fields
function toModelFields(body, tenantId) {
  if (!body) return {};
  return {
    tenantId,
    planName: body.planName ?? body.name,
    planPrice: body.planPrice ?? body.price,
    planDuration: body.planDuration ?? body.duration,
    planSpeed: body.planSpeed ?? body.speed,
    mikrotikServer: body.mikrotikServer ?? body.server,
    mikrotikProfile: body.mikrotikProfile ?? body.profile,
    sharedSecret: body.sharedSecret ?? body.secret ?? '',
  };
}

// Map model document -> response payload (UI shape)
function toUiShape(doc) {
  if (!doc) return doc;
  const d = doc.toObject ? doc.toObject() : doc;
  return {
    _id: d._id,
    name: d.planName,
    price: d.planPrice,
    duration: d.planDuration,
    speed: d.planSpeed,
    server: d.mikrotikServer,
    profile: d.mikrotikProfile,
    secret: d.sharedSecret,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

// CREATE a new plan
router.post('/', async (req, res) => {
  try {
    const payload = toModelFields(req.body, req.tenantId);
    const plan = await HotspotPlan.create(payload);
    res.status(201).json({ message: 'Plan created', plan: toUiShape(plan) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// READ all plans
router.get('/', async (req, res) => {
  try {
    const plans = await HotspotPlan.find({ tenantId: req.tenantId }).sort({ createdAt: -1 });
    res.json(plans.map(toUiShape));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// READ a single plan
router.get('/:id', async (req, res) => {
  try {
    const plan = await HotspotPlan.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    res.json(toUiShape(plan));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE a plan
router.put('/:id', async (req, res) => {
  try {
    const payload = toModelFields(req.body, req.tenantId);
    const updated = await HotspotPlan.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { $set: payload },
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ error: 'Plan not found' });
    res.json({ message: 'Plan updated', plan: toUiShape(updated) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE a plan
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await HotspotPlan.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
    if (!deleted) return res.status(404).json({ error: 'Plan not found' });
    res.json({ message: 'Plan deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
