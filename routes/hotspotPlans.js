  const express = require('express');
const router = express.Router();
const HotspotPlan = require('../models/HotspotPlan');

// CREATE a new plan
router.post('/', async (req, res) => {
  try {
    const plan = new HotspotPlan(req.body);
    await plan.save();
    res.status(201).json(plan);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// READ all plans
router.get('/', async (req, res) => {
  try {
    const plans = await HotspotPlan.find().sort({ createdAt: -1 });
    res.json(plans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// READ a single plan
router.get('/:id', async (req, res) => {
  try {
    const plan = await HotspotPlan.findById(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE a plan
router.put('/:id', async (req, res) => {
  try {
    const updated = await HotspotPlan.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE a plan
router.delete('/:id', async (req, res) => {
  try {
    await HotspotPlan.findByIdAndDelete(req.params.id);
    res.json({ message: 'Plan deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
