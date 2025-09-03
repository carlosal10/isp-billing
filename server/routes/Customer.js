// routes/customers.js
const express = require('express');
const router = express.Router();

const Customer = require('../models/customers.js');
const Plan = require('../models/plan.js');
const { sendCommand } = require('../utils/mikrotikConnectionManager');
const {
  applyCustomerQueue,
  removeCustomerQueue,
  updateCustomerQueue,
} = require('../utils/mikrotikBandwidthManager');

// ----------------- Helpers -----------------
function generateAccountNumber() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// Make profiles shape robust: return [{ id, name, localAddress, rateLimit }]
function normalizeProfiles(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw.profiles) ? raw.profiles : [];
  return arr
    .map((p, i) => {
      if (p == null) return null;
      // MikroTik usually: { '.id': '*1', name: 'profile', 'local-address': 'x', 'rate-limit': '10M/10M' }
      const id = String(p['.id'] ?? p.id ?? i);
      const name =
        String(
          p.name ??
            p.profile ??
            p.profileName ??
            p.title ??
            p.id ??
            p._id ??
            p['.id'] ??
            `profile_${i}`
        );
      const localAddress = p['local-address'] ?? p.localAddress ?? null;
      const rateLimit = p['rate-limit'] ?? p.rateLimit ?? '';
      return { id, name, localAddress, rateLimit };
    })
    .filter(Boolean);
}

// ----------------- PPPoE Profiles -----------------
router.get('/profiles', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    // Execute against tenant-scoped MikroTik connection (may throw if not configured)
    const profiles = await sendCommand('/ppp/profile/print', [], { tenantId, timeoutMs: 10000 });
    const formatted = normalizeProfiles(profiles);
    return res.json({ message: 'Profiles loaded from MikroTik', profiles: formatted });
  } catch (err) {
    console.error('profiles error:', err?.message || err);
    // Degrade gracefully so UI can proceed; surface message but avoid 500
    return res.json({
      message: 'No PPPoE profiles available (router not connected or unauthorized)',
      profiles: [],
      error: String(err?.message || err),
    });
  }
});

// ----------------- Customers: List -----------------
router.get('/', async (_req, res) => {
  try {
    const customers = await Customer.find()
      // add speed so UI and queue logic can use it consistently
      .populate('plan', 'name price duration speed')
      .lean();
    return res.json(customers);
  } catch (err) {
    console.error('list customers error:', err);
    return res.status(500).json({ message: 'Failed to retrieve customers' });
  }
});

// ----------------- Customers: Search -----------------
router.get('/search', async (req, res) => {
  const { query } = req.query;
  if (!query || !query.trim()) return res.json([]);

  try {
    const regex = new RegExp(query.trim(), 'i');
    const customers = await Customer.find(
      { $or: [{ name: regex }, { accountNumber: regex }] },
      { name: 1, accountNumber: 1 }
    )
      .limit(10)
      .lean();

    return res.json(customers);
  } catch (err) {
    console.error('customer search failed:', err);
    return res.status(500).json({ error: 'Search failed' });
  }
});

// ----------------- Customers: Get by ID -----------------
router.get('/by-id/:id', async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id)
      .populate('plan', 'name price duration speed')
      .lean();
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    return res.json(customer);
  } catch (err) {
    console.error('by-id error:', err);
    return res.status(500).json({ message: 'Error retrieving customer' });
  }
});

// ----------------- Customers: Get by Account -----------------
router.get('/by-account/:accountNumber', async (req, res) => {
  try {
    const customer = await Customer.findOne({ accountNumber: req.params.accountNumber })
      .populate('plan', 'name price duration speed')
      .lean();
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    return res.json(customer);
  } catch (err) {
    console.error('by-account error:', err);
    return res.status(500).json({ message: 'Error retrieving customer' });
  }
});

// ----------------- Create Customer -----------------
router.post('/', async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      address,
      routerIp,
      plan: planId,
      connectionType, // "pppoe" | "static"
      pppoeConfig,
      staticConfig,
    } = req.body;

    const accountNumber = String(generateAccountNumber()).trim();

    const plan = await Plan.findById(planId);
    if (!plan) return res.status(400).json({ message: 'Invalid plan selected' });

    if (connectionType === 'pppoe' && (!pppoeConfig || !pppoeConfig.profile)) {
      return res.status(400).json({ message: 'PPPoE profile is required for PPPoE connections' });
    }

    const customer = new Customer({
      name,
      email,
      phone,
      address,
      routerIp: routerIp || null,
      status: 'active',
      accountNumber,
      plan: planId,
      connectionType,
      pppoeConfig:
        connectionType === 'pppoe'
          ? {
              profile: pppoeConfig.profile,
              localAddress: pppoeConfig.localAddress || null,
              // keep consistent with plan.speed (Mbps)
              rateLimit: `${plan.speed}M/0M`,
            }
          : undefined,
      staticConfig: connectionType === 'static' ? staticConfig : undefined,
    });

    const newCustomer = await customer.save();

    if (connectionType === 'pppoe') {
      const tenantId = req.tenantId;
      const words = [
        `=name=${accountNumber}`,
        `=password=defaultpass`,
        `=profile=${pppoeConfig.profile}`,
        `=service=pppoe`,
        `=comment=Customer: ${name}`,
      ];
      try {
        await sendCommand('/ppp/secret/add', words, { tenantId, timeoutMs: 10000 });
      } catch (e) {
        console.error('MikroTik add secret failed:', e?.message || e);
        await Customer.findByIdAndDelete(newCustomer._id);
        return res.status(500).json({ message: 'Failed to create PPPoE secret: ' + (e?.message || e) });
      }
    }

    try {
      await applyCustomerQueue(newCustomer, plan);
    } catch (e) {
      console.warn('Queue apply failed:', e?.message || e);
    }

    return res.status(201).json({ message: 'Customer created successfully', customer: newCustomer });
  } catch (err) {
    console.error('Create customer failed:', err);
    return res.status(400).json({ message: 'Failed to create customer: ' + err.message });
  }
});

// ----------------- Update Customer -----------------
router.put('/:id', async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    const { plan: planId, connectionType, pppoeConfig, staticConfig } = req.body;

    const plan = await Plan.findById(planId || customer.plan);
    if (!plan) return res.status(400).json({ message: 'Invalid plan selected' });

    // Apply basic updates
    Object.assign(customer, req.body);

    if (connectionType === 'pppoe') {
      if (!pppoeConfig?.profile) return res.status(400).json({ message: 'PPPoE profile required' });
      customer.staticConfig = undefined;
      customer.pppoeConfig = {
        profile: pppoeConfig.profile,
        localAddress: pppoeConfig.localAddress || null,
        rateLimit: `${plan.speed}M/0M`,
      };

      const tenantId = req.tenantId;
      const words = [`=numbers=${customer.accountNumber}`, `=profile=${pppoeConfig.profile}`];
      try {
        await sendCommand('/ppp/secret/set', words, { tenantId, timeoutMs: 10000 });
      } catch (e) {
        return res.status(500).json({ message: 'Failed to update PPPoE secret: ' + (e?.message || e) });
      }
    } else if (connectionType === 'static') {
      customer.pppoeConfig = undefined;
      customer.staticConfig = staticConfig;
    }

    const updated = await customer.save();

    try {
      await updateCustomerQueue(customer, plan);
    } catch (e) {
      console.warn('Queue update failed:', e?.message || e);
    }

    return res.json({ message: 'Customer updated successfully', customer: updated });
  } catch (err) {
    console.error('Update customer failed:', err);
    return res.status(400).json({ message: 'Failed to update customer: ' + err.message });
  }
});

// ----------------- Delete Customer -----------------
router.delete('/:id', async (req, res) => {
  try {
    const customer = await Customer.findByIdAndDelete(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    if (customer.connectionType === 'pppoe') {
      const tenantId = req.tenantId;
      const words = [`=numbers=${customer.accountNumber}`];
      try {
        await sendCommand('/ppp/secret/remove', words, { tenantId, timeoutMs: 10000 });
      } catch (e) {
        console.warn('PPPoE secret remove failed:', e?.message || e);
      }
    }

    try {
      await removeCustomerQueue(customer);
    } catch (e) {
      console.warn('Queue remove failed:', e?.message || e);
    }

    return res.json({ message: 'Customer deleted successfully' });
  } catch (err) {
    console.error('Delete customer failed:', err);
    return res.status(500).json({ message: 'Error deleting customer: ' + err.message });
  }
});

module.exports = router;
