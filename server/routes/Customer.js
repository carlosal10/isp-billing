const express = require('express');
const router = express.Router();
const Customer = require('../models/customers.js');
const Plan = require('../models/plan.js');
const PPPoEProfile = require('../models/pppoeUsers.js');

// ✅ Get profiles directly from MikroTik
router.get('/profiles', async (req, res) => {
  try {
    const profiles = await sendCommand('/ppp/profile/print');

    if (!profiles.length) {
      return res.status(404).json({ message: 'No profiles found on MikroTik' });
    }

    const formatted = profiles.map((p, index) => ({
      id: p['.id'] || index, // fallback to index if no .id
      name: p.name,
      localAddress: p['local-address'] || null,
      rateLimit: p['rate-limit'] || null,
    }));

    res.json({ message: 'Profiles loaded from MikroTik', profiles: formatted });
  } catch (err) {
    console.error("Error fetching MikroTik profiles:", err);
    res.status(500).json({ message: err.message });
  }
});

// Generate random account number
function generateAccountNumber() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// Get all customers with plan populated
router.get('/', async (req, res) => {
  try {
    const customers = await Customer.find().populate('plan', 'name price duration');
    res.json(customers);
  } catch (err) {
    res.status(500).json({ message: 'Failed to retrieve customers', error: err.message });
  }
});

// Get by Mongo ID
router.get('/:id', async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id).populate('plan', 'name price duration');
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    res.json(customer);
  } catch (err) {
    res.status(500).json({ message: 'Error retrieving customer', error: err.message });
  }
});

// Get by Account Number
router.get('/:accountNumber', async (req, res) => {
  try {
    const customer = await Customer.findOne({ accountNumber: req.params.accountNumber }).populate('plan');
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    res.json(customer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create new customer
router.post('/', async (req, res) => {
  const { name, email, phone, address, routerIp, plan, connectionType, pppoeConfig, staticConfig } = req.body;

  try {
    const accountNumber = generateAccountNumber();

    const customer = new Customer({
      name,
      email,
      phone,
      address,
      routerIp: routerIp || null,
      status: 'active',
      accountNumber,
      plan,
      connectionType,
      pppoeConfig: connectionType === 'pppoe' ? pppoeConfig : undefined,
      staticConfig: connectionType === 'static' ? staticConfig : undefined
    });

    const newCustomer = await customer.save();
    res.status(201).json(newCustomer);
  } catch (err) {
    res.status(400).json({ message: 'Failed to create customer', error: err.message });
  }
});

// Update customer (single clean PUT)
router.put('/:id', async (req, res) => {
  const { name, email, phone, address, routerIp, plan, status, connectionType, pppoeConfig, staticConfig } = req.body;

  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    customer.name = name ?? customer.name;
    customer.email = email ?? customer.email;
    customer.phone = phone ?? customer.phone;
    customer.address = address ?? customer.address;
    customer.routerIp = routerIp ?? customer.routerIp;
    customer.plan = plan ?? customer.plan;
    customer.status = status ?? customer.status;

    if (connectionType) {
      customer.connectionType = connectionType;
      if (connectionType === 'pppoe') {
        customer.pppoeConfig = pppoeConfig || customer.pppoeConfig;
        customer.staticConfig = undefined;
      } else if (connectionType === 'static') {
        customer.staticConfig = staticConfig || customer.staticConfig;
        customer.pppoeConfig = undefined;
      }
    }

    const updated = await customer.save();
    res.json({ message: "✅ Customer updated successfully", customer: updated });
  } catch (err) {
    res.status(400).json({ message: 'Failed to update customer', error: err.message });
  }
});

// Delete customer
router.delete('/:id', async (req, res) => {
  try {
    const customer = await Customer.findByIdAndDelete(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    res.json({ message: 'Customer deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting customer', error: err.message });
  }
});

module.exports = router;
