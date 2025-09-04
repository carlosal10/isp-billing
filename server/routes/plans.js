// routes/plans.js
const express = require('express');
const router = express.Router();
const Plan = require('../models/plan');

// ---- utils ----
function parseDurationToDays(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  const s = String(v).trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);

  const m = s.match(/(\d+(\.\d+)?)\s*(day|week|month|year)s?/);
  if (m) {
    const n = parseFloat(m[1]);
    const unit = m[3];
    if (unit === 'day') return n;
    if (unit === 'week') return n * 7;
    if (unit === 'month') return n * 30;   // simple approx
    if (unit === 'year') return n * 365;
  }
  if (s === 'monthly' || s === 'month') return 30;
  if (s === 'weekly' || s === 'week') return 7;
  if (s === 'yearly' || s === 'annual' || s === 'year') return 365;

  const num = parseFloat(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(num) ? num : NaN;
}

function formatPlan(p) {
  return {
    ...p,
    priceFormatted: `${p.price} KSH`,
  };
}

// ---------- GET all ----------
router.get('/', async (req, res) => {
  try {
    const plans = await Plan.find({ tenantId: req.tenantId }).lean();
    res.status(200).json(plans.map(formatPlan));
  } catch (err) {
    res.status(500).json({ message: 'Error fetching plans: ' + err.message });
  }
});

// ---------- GET by id ----------
router.get('/:id', async (req, res) => {
  try {
    const plan = await Plan.findOne({ _id: req.params.id, tenantId: req.tenantId }).lean();
    if (!plan) return res.status(404).json({ message: 'Plan not found' });
    res.status(200).json(formatPlan(plan));
  } catch (err) {
    res.status(500).json({ message: 'Error fetching plan: ' + err.message });
  }
});

// ---------- CREATE ----------
router.post('/', async (req, res) => {
  try {
    let { name, description, price, duration, speed, rateLimit, dataCap } = req.body;

    if (!name || price == null || duration == null || speed == null || !rateLimit) {
      return res.status(400).json({ message: 'Name, Price, Duration, Speed, and RateLimit are required fields' });
    }

    // Coerce numbers safely
    const priceNum = Number(price);
    const speedNum = Number(speed);
    const durationDays = parseDurationToDays(duration);

    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return res.status(400).json({ message: 'Invalid price (number >= 0 required)' });
    }
    if (!Number.isFinite(speedNum) || speedNum <= 0) {
      return res.status(400).json({ message: 'Invalid speed (number > 0 required)' });
    }
    if (!Number.isFinite(durationDays) || durationDays <= 0) {
      return res.status(400).json({ message: 'Invalid duration (days > 0 required)' });
    }

    const newPlan = await Plan.create({
      tenantId: req.tenantId,
      name: String(name).trim(),
      description: description || 'No description provided',
      price: priceNum,
      duration: durationDays,
      speed: speedNum,
      rateLimit: String(rateLimit).trim(),
      dataCap: dataCap ?? null,
    });

    res.status(201).json(formatPlan(newPlan.toObject()));
  } catch (err) {
    res.status(400).json({ message: 'Error creating plan: ' + err.message });
  }
});

// ---------- UPDATE ----------
router.put('/:id', async (req, res) => {
  try {
    const updates = {};
    const {
      name, description, price, duration, speed, rateLimit, dataCap
    } = req.body;

    if (name != null) updates.name = String(name).trim();
    if (description != null) updates.description = description;

    if (price != null) {
      const priceNum = Number(price);
      if (!Number.isFinite(priceNum) || priceNum < 0) {
        return res.status(400).json({ message: 'Invalid price (number >= 0 required)' });
      }
      updates.price = priceNum;
    }

    if (duration != null) {
      const durationDays = parseDurationToDays(duration);
      if (!Number.isFinite(durationDays) || durationDays <= 0) {
        return res.status(400).json({ message: 'Invalid duration (days > 0 required)' });
      }
      updates.duration = durationDays;
    }

    if (speed != null) {
      const speedNum = Number(speed);
      if (!Number.isFinite(speedNum) || speedNum <= 0) {
        return res.status(400).json({ message: 'Invalid speed (number > 0 required)' });
      }
      updates.speed = speedNum;
    }

    if (rateLimit != null) updates.rateLimit = String(rateLimit).trim();
    if (dataCap !== undefined) updates.dataCap = dataCap;

    const updated = await Plan.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { $set: updates },
      { new: true, runValidators: true }
    ).lean();

    if (!updated) return res.status(404).json({ message: 'Plan not found' });
    res.status(200).json(formatPlan(updated));
  } catch (err) {
    res.status(400).json({ message: 'Error updating plan: ' + err.message });
  }
});

// ---------- DELETE ----------
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Plan.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
    if (!deleted) return res.status(404).json({ message: 'Plan not found' });
    res.status(200).json({ message: 'Plan deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting plan: ' + err.message });
  }
});

module.exports = router;
