const express = require('express');
const router = express.Router();
const Customer = require('../models/customers.js');
const Plan = require('../models/plan.js'); // Reference the Plan schema

// Utility function to generate a random alphanumeric 10-character account number
function generateAccountNumber() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 10; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
// In your customers route file (e.g., customers.js)
router.get('/:accountNumber', async (req, res) => {
    try {
        const customer = await Customer.findOne({ accountNumber: req.params.accountNumber }).populate('plan');
        if (!customer) {
            return res.status(404).json({ message: 'Customer not found' });
        }
        res.json(customer);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});
// GET all plans
router.get('/plans', async (req, res) => {
    try {
        const plans = await Plan.find(); // Or select only needed fields
        res.json(plans);
    } catch (err) {
        res.status(500).json({ message: 'Failed to retrieve plans', error: err.message });
    }
});


// GET all customers with populated plan details
router.get('/', async (req, res) => {
    try {
        const customers = await Customer.find().populate('plan', 'name price duration'); // Populate plan details
        res.json(customers);
    } catch (err) {
        res.status(500).json({ message: 'Failed to retrieve customers', error: err.message });
    }
});

// GET a specific customer by ID with populated plan details
router.get('/:id', async (req, res) => {
    try {
        const customer = await Customer.findById(req.params.id).populate('plan', 'name price duration');
        if (!customer) {
            return res.status(404).json({ message: 'Customer not found' });
        }
        res.json(customer);
    } catch (err) {
        res.status(500).json({ message: 'Error retrieving customer', error: err.message });
    }
});

// POST - Create a new customer with an auto-generated account number
router.post('/', async (req, res) => {
    const { name, email, phone, address, routerIp, plan } = req.body;

    try {
        const accountNumber = generateAccountNumber(); // Auto-generate account number

        const customer = new Customer({
            name,
            email,
            phone,
            address,
            routerIp: routerIp || null, // Default to null if not provided
            status: 'active', // Default status is 'active'
            accountNumber,
            plan, // Plan ID
        });

        const newCustomer = await customer.save();
        res.status(201).json(newCustomer);
    } catch (err) {
        res.status(400).json({ message: 'Failed to create customer', error: err.message });
    }
});

// PUT - Update an existing customer
router.put('/:id', async (req, res) => {
    const { name, email, phone, address, routerIp, plan, status } = req.body;

    try {
        const customer = await Customer.findById(req.params.id);

        if (!customer) {
            return res.status(404).json({ message: 'Customer not found' });
        }

        // Update fields conditionally
        customer.name = name || customer.name;
        customer.email = email || customer.email;
        customer.phone = phone || customer.phone;
        customer.address = address || customer.address;
        customer.routerIp = routerIp || customer.routerIp;
        customer.plan = plan || customer.plan;
        customer.status = status || customer.status;

        const updatedCustomer = await customer.save();
        res.json(updatedCustomer);
    } catch (err) {
        res.status(400).json({ message: 'Failed to update customer', error: err.message });
    }
});

// DELETE - Remove a customer by ID
router.delete('/:id', async (req, res) => {
    try {
        const customer = await Customer.findByIdAndDelete(req.params.id);

        if (!customer) {
            return res.status(404).json({ message: 'Customer not found' });
        }

        res.json({ message: 'Customer deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Error deleting customer', error: err.message });
    }
});

module.exports = router;
