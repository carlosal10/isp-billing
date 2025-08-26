const express = require('express');
const router = express.Router();
const Customer = require('../models/customers.js');
const Plan = require('../models/plan.js');
const PPPoEProfile = require('../models/pppoeUsers.js');
const { sendCommand } = require('../utils/mikrotik.js'); // example

// Generate random account number
function generateAccountNumber() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// Get all PPPoE profiles
router.get('/profiles', async (req, res) => {
  try {
    const profiles = await sendCommand('/ppp/profile/print');
    const formatted = Array.isArray(profiles) && profiles.length
      ? profiles.map((p, i) => ({
          id: p['.id'] || i,
          name: p.name,
          localAddress: p['local-address'] || null,
          rateLimit: p['rate-limit'] || null,
        }))
      : [];
    res.json({ message: 'Profiles loaded from MikroTik', profiles: formatted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load PPPoE profiles' });
  }
});

// Get all customers
router.get('/', async (req, res) => {
  try {
    const customers = await Customer.find().populate('plan', 'name speed price duration');
    res.json(customers);
  } catch {
    res.status(500).json({ message: 'Failed to retrieve customers' });
  }
});

// Get customer by ID
router.get('/by-id/:id', async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id).populate('plan', 'name speed price duration');
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    res.json(customer);
  } catch {
    res.status(500).json({ message: 'Error retrieving customer' });
  }
});

// Get customer by account number
router.get('/by-account/:accountNumber', async (req, res) => {
  try {
    const customer = await Customer.findOne({ accountNumber: req.params.accountNumber }).populate('plan', 'name speed price duration');
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    res.json(customer);
  } catch {
    res.status(500).json({ message: 'Error retrieving customer' });
  }
});

// Create customer
router.post('/', async (req, res) => {
  try {
    const { name, email, phone, address, routerIp, plan, connectionType, pppoeConfig, staticConfig } = req.body;
    const accountNumber = generateAccountNumber();

    const customer = new Customer({
      name, email, phone, address, routerIp: routerIp || null,
      status: 'active', accountNumber, plan, connectionType,
      pppoeConfig: connectionType === 'pppoe' ? pppoeConfig : undefined,
      staticConfig: connectionType === 'static' ? staticConfig : undefined,
    });

    const newCustomer = await customer.save();
    res.status(201).json({ message: 'Customer created', customer: newCustomer });
  } catch {
    res.status(400).json({ message: 'Failed to create customer' });
  }
});

// Update customer
router.put('/:id', async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    Object.assign(customer, req.body);

    if (req.body.connectionType === 'pppoe') customer.staticConfig = undefined;
    if (req.body.connectionType === 'static') customer.pppoeConfig = undefined;

    const updated = await customer.save();
    res.json({ message: 'Customer updated successfully', customer: updated });
  } catch {
    res.status(400).json({ message: 'Failed to update customer' });
  }
});

// Delete customer
router.delete('/:id', async (req, res) => {
  try {
    const customer = await Customer.findByIdAndDelete(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    res.json({ message: 'Customer deleted successfully' });
  } catch {
    res.status(500).json({ message: 'Error deleting customer' });
  }
});

module.exports = router;
