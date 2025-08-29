const express = require('express');
const router = express.Router();
const Customer = require('../models/customers.js');
const Plan = require('../models/plan.js');
const { sendCommand } = require('../utils/mikrotikConnectionManager');
const { 
  applyCustomerQueue,
  removeCustomerQueue,
  updateCustomerQueue,
  disableCustomerQueue,
  enableCustomerQueue
} = require('../utils/mikrotikBandwidthManager');

// Generate random account number
function generateAccountNumber() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ----------------- PPPoE Profiles -----------------
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

// ----------------- Customers -----------------
router.get('/', async (req, res) => {
  try {
    const customers = await Customer.find().populate('plan', 'name price duration');
    res.json(customers);
  } catch (err) {
    res.status(500).json({ message: 'Failed to retrieve customers' });
  }
});

router.get('/by-id/:id', async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id).populate('plan', 'name price duration');
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    res.json(customer);
  } catch (err) {
    res.status(500).json({ message: 'Error retrieving customer' });
  }
});

router.get('/by-account/:accountNumber', async (req, res) => {
  try {
    const customer = await Customer.findOne({ accountNumber: req.params.accountNumber }).populate('plan', 'name price duration');
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    res.json(customer);
  } catch (err) {
    res.status(500).json({ message: 'Error retrieving customer' });
  }
});

// ----------------- Create Customer -----------------
router.post("/", async (req, res) => {
  try {
    const {
      name, email, phone, address, routerIp,
      plan: planId, connectionType, pppoeConfig, staticConfig,
    } = req.body;

    // 1) Generate username first (we use accountNumber as PPPoE username)
    const accountNumber = String(generateAccountNumber()).trim();
    console.log("✅ Generated accountNumber:", accountNumber);

    // 2) Validate plan
    const plan = await Plan.findById(planId);
    if (!plan) return res.status(400).json({ message: "Invalid plan selected" });

    // 3) Validate PPPoE fields if needed
    if (connectionType === "pppoe" && (!pppoeConfig || !pppoeConfig.profile)) {
      return res.status(400).json({ message: "PPPoE profile is required for PPPoE connections" });
    }

    // 4) Prepare & save customer
    const customer = new Customer({
      name, email, phone, address,
      routerIp: routerIp || null,
      status: "active",
      accountNumber,
      plan: planId,
      connectionType,
      pppoeConfig: connectionType === "pppoe"
        ? { profile: pppoeConfig.profile, localAddress: pppoeConfig.localAddress || null, rateLimit: `${plan.speed}M/0M` }
        : undefined,
      staticConfig: connectionType === "static" ? staticConfig : undefined,
    });
    const newCustomer = await customer.save();

    // 5) MikroTik PPPoE secret (ARRAY OF WORDS)
    if (connectionType === "pppoe") {
      const words = [
        `=name=${accountNumber}`,
        `=password=defaultpass`,
        `=profile=${pppoeConfig.profile}`,
        `=service=pppoe`,
        `=comment=Customer: ${name}`,
      ];
      console.log("📡 /ppp/secret/add", words);
      try {
        await sendCommand("/ppp/secret/add", words);
        console.log("✅ PPPoE secret created for", accountNumber);
      } catch (e) {
        console.error("❌ MikroTik add secret failed:", e?.message || e);
        // rollback DB if RouterOS failed to create secret
        await Customer.findByIdAndDelete(newCustomer._id);
        return res.status(500).json({ message: "Failed to create PPPoE secret: " + (e?.message || e) });
      }
    }

    // 6) Bandwidth queue (best-effort)
    try { await applyCustomerQueue(newCustomer, plan); } catch (e) { console.warn("⚠️ Queue apply failed:", e?.message || e); }

    res.status(201).json({ message: "Customer created successfully", customer: newCustomer });
  } catch (err) {
    console.error("❌ Create customer failed:", err);
    res.status(400).json({ message: "Failed to create customer: " + err.message });
  }
});

// ----------------- Update Customer -----------------
router.put("/:id", async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: "Customer not found" });

    const { plan: planId, connectionType, pppoeConfig, staticConfig } = req.body;

    // Plan changes
    let plan = await Plan.findById(planId || customer.plan);
    if (!plan) return res.status(400).json({ message: "Invalid plan selected" });

    Object.assign(customer, req.body);

    if (connectionType === "pppoe") {
      if (!pppoeConfig?.profile) return res.status(400).json({ message: "PPPoE profile required" });
      customer.staticConfig = undefined;
      customer.pppoeConfig = {
        profile: pppoeConfig.profile,
        localAddress: pppoeConfig.localAddress || null,
        rateLimit: `${plan.speed}M/0M`,
      };

      const words = [
        `=numbers=${customer.accountNumber}`,
        `=profile=${pppoeConfig.profile}`,
      ];
      console.log("📡 /ppp/secret/set", words);
      try { await sendCommand("/ppp/secret/set", words); }
      catch (e) { return res.status(500).json({ message: "Failed to update PPPoE secret: " + (e?.message || e) }); }

    } else if (connectionType === "static") {
      customer.pppoeConfig = undefined;
      customer.staticConfig = staticConfig;
    }

    const updated = await customer.save();

    try { await updateCustomerQueue(customer, plan); } catch (e) { console.warn("⚠️ Queue update failed:", e?.message || e); }
    res.json({ message: "Customer updated successfully", customer: updated });
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: "Failed to update customer: " + err.message });
  }
});

router.get('/', async (req, res) => {
  const { search } = req.query;
  if (!search) return res.json([]);

  try {
    const regex = new RegExp(search, 'i'); // case-insensitive
    const customers = await Customer.find({
      $or: [{ name: regex }, { accountNumber: regex }],
    }).limit(10);
    
    // return only needed fields
    const result = customers.map(c => ({
      _id: c._id,
      name: c.name,
      accountNumber: c.accountNumber
    }));

    res.json(result);
  } catch (err) {
    console.error('Customer search failed:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});


// ----------------- Delete Customer -----------------
router.delete("/:id", async (req, res) => {
  try {
    const customer = await Customer.findByIdAndDelete(req.params.id);
    if (!customer) return res.status(404).json({ message: "Customer not found" });

    if (customer.connectionType === "pppoe") {
      const words = [`=numbers=${customer.accountNumber}`];
      console.log("📡 /ppp/secret/remove", words);
      try { await sendCommand("/ppp/secret/remove", words); }
      catch (e) { console.warn("⚠️ PPPoE secret remove failed:", e?.message || e); }
    }

    try { await removeCustomerQueue(customer); } catch (e) { console.warn("⚠️ Queue remove failed:", e?.message || e); }
    res.json({ message: "Customer deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error deleting customer: " + err.message });
  }
});

module.exports = router;
