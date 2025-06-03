const express = require('express');
const router = express.Router();
const UsageLog = require('../models/UsageLog');

// Get all usage logs
router.get('/', async (req, res) => {
    try {
        const logs = await UsageLog.find().populate('customer', 'name email');
        res.json(logs);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Get usage logs by customer
router.get('/customer/:customerId', async (req, res) => {
    try {
        const logs = await UsageLog.find({ customer: req.params.customerId });
        res.json(logs);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Add a usage log
router.post('/', async (req, res) => {
    const { customer, dataUsed } = req.body;

    try {
        const usageLog = new UsageLog({
            customer,
            dataUsed,
        });

        const newLog = await usageLog.save();
        res.status(201).json(newLog);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Delete a usage log
router.delete('/:id', async (req, res) => {
    try {
        const log = await UsageLog.findById(req.params.id);
        if (!log) return res.status(404).json({ message: 'Log not found' });

        await log.remove();
        res.json({ message: 'Log deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
