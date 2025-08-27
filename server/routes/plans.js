const express = require('express');
const router = express.Router();
const Plan = require('../models/plan');

// Get all plans
router.get('/', async (req, res) => {
    try {
        const plans = await Plan.find();
        const plansWithCurrency = plans.map(plan => ({
            ...plan.toObject(),
            price: `${plan.price} KSH`, // Append KSH
        }));
        res.status(200).json(plansWithCurrency);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching plans: ' + err.message });
    }
});

// Get a specific plan
router.get('/:id', async (req, res) => {
    try {
        const plan = await Plan.findById(req.params.id);
        if (!plan) return res.status(404).json({ message: 'Plan not found' });
        plan.price = `${plan.price} KSH`;
        res.status(200).json(plan);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching plan: ' + err.message });
    }
});

// Create a new plan
router.post('/', async (req, res) => {
    const { name, description, price, duration, speed, rateLimit, dataCap } = req.body;

    if (!name || !price || !duration || !speed || !rateLimit) {
        return res.status(400).json({ message: 'Name, Price, Duration, Speed, and RateLimit are required fields' });
    }

    const plan = new Plan({
        name,
        description: description || 'No description provided',
        price,
        duration,
        speed,
        rateLimit,
        dataCap: dataCap || null
    });

    try {
        const newPlan = await plan.save();
        newPlan.price = `${newPlan.price} KSH`;
        res.status(201).json(newPlan);
    } catch (err) {
        res.status(400).json({ message: 'Error creating plan: ' + err.message });
    }
});

// Update an existing plan
router.put('/:id', async (req, res) => {
    const { name, description, price, duration, speed, rateLimit, dataCap } = req.body;

    try {
        const plan = await Plan.findById(req.params.id);
        if (!plan) return res.status(404).json({ message: 'Plan not found' });

        plan.name = name || plan.name;
        plan.description = description || plan.description;
        plan.price = price || plan.price;
        plan.duration = duration || plan.duration;
        plan.speed = speed || plan.speed;
        plan.rateLimit = rateLimit || plan.rateLimit;
        plan.dataCap = dataCap !== undefined ? dataCap : plan.dataCap;

        const updatedPlan = await plan.save();
        updatedPlan.price = `${updatedPlan.price} KSH`;
        res.status(200).json(updatedPlan);
    } catch (err) {
        res.status(400).json({ message: 'Error updating plan: ' + err.message });
    }
});

// Delete a plan
router.delete('/:id', async (req, res) => {
    try {
        const plan = await Plan.findById(req.params.id);
        if (!plan) return res.status(404).json({ message: 'Plan not found' });
        await plan.remove();
        res.status(200).json({ message: 'Plan deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Error deleting plan: ' + err.message });
    }
});

module.exports = router;
