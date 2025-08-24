const express = require('express');
const router = express.Router();
const Customer = require('../models/customers'); // Assuming you have a Customer model
const Plan = require('../models/plan');         // Assuming you have a Plan model
const Invoice = require('../models/Invoice');   // Assuming you have an Invoice model

// Route to fetch dashboard stats
router.get('/', async (req, res) => {
    try {
        // Fetch total customers
        const totalCustomers = await Customer.countDocuments();

        // Fetch active plans (Assuming 'active' is a boolean field in the Plan schema)
        const totalPlans = await Plan.countDocuments();

        // Fetch pending invoices (Assuming 'status' field with 'pending' value in Invoice schema)
        const pendingInvoices = await Invoice.countDocuments({ status: 'pending' });

        // Return stats as JSON
        res.json({
            totalCustomers,
            totalPlans,
            pendingInvoices
        });
    } catch (err) {
        res.status(500).json({ message: 'Error fetching stats: ' + err.message });
    }
});

module.exports = router;
