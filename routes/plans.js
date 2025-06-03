const express = require('express');
const router = express.Router();
const Plan = require('../models/plan');

// Get all plans
router.get('/', async (req, res) => {
    try {
        const plans = await Plan.find();
        // Include the currency as part of the price
        const plansWithCurrency = plans.map(plan => ({
            ...plan.toObject(),
            price: `${plan.price} KSH`,  // Append KSH to the price field
        }));
        res.status(200).json(plansWithCurrency); // Returning plans as JSON with KSH
    } catch (err) {
        res.status(500).json({ message: 'Error fetching plans: ' + err.message });
    }
});

// Get a specific plan
router.get('/:id', async (req, res) => {
    try {
        const plan = await Plan.findById(req.params.id);
        if (!plan) {
            return res.status(404).json({ message: 'Plan not found' });
        }
        // Add KSH to the price field in the response
        plan.price = `${plan.price} KSH`;
        res.status(200).json(plan); // Returning the specific plan with KSH
    } catch (err) {
        res.status(500).json({ message: 'Error fetching plan: ' + err.message });
    }
});

// Create a new plan
router.post('/', async (req, res) => {
    const { name, description, price, duration } = req.body;

    if (!name || !price || !duration) {
        return res.status(400).json({ message: 'Name, Price, and Duration are required fields' });
    }

    const plan = new Plan({
        name,
        description: description || 'No description provided', // Default description
        price, // Assume price is provided in KSH
        duration, // Duration should be provided from frontend
    });

    try {
        const newPlan = await plan.save();
        res.status(201).json(newPlan); // Return the newly created plan
    } catch (err) {
        res.status(400).json({ message: 'Error creating plan: ' + err.message });
    }
});

// Update an existing plan
router.put('/:id', async (req, res) => {
    const { name, description, price, duration } = req.body;

    try {
        const plan = await Plan.findById(req.params.id);
        if (!plan) {
            return res.status(404).json({ message: 'Plan not found' });
        }

        // Update fields with the values from the request, if provided
        plan.name = name || plan.name;
        plan.description = description || plan.description;
        plan.price = price || plan.price;
        plan.duration = duration || plan.duration;

        const updatedPlan = await plan.save();
        // Append KSH to the updated price before sending the response
        updatedPlan.price = `${updatedPlan.price} KSH`;
        res.status(200).json(updatedPlan); // Return the updated plan with KSH
    } catch (err) {
        res.status(400).json({ message: 'Error updating plan: ' + err.message });
    }
});

// Delete a plan
router.delete('/:id', async (req, res) => {
    try {
        const plan = await Plan.findById(req.params.id);
        if (!plan) {
            return res.status(404).json({ message: 'Plan not found' });
        }

        await plan.remove();
        res.status(200).json({ message: 'Plan deleted successfully' }); // Return success message
    } catch (err) {
        res.status(500).json({ message: 'Error deleting plan: ' + err.message });
    }
});

module.exports = router;
