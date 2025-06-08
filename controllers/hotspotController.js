// controllers/hotspotController.js
const HotspotPlan = require('../models/HotspotPlan');
const RegisteredHotspotUser = require('../models/RegisteredHotspotUser');
const { connectToMikroTik } = require('../routes/mikrotikConnect');
const HotspotAccess = require('../models/HotspotAccess');
const { getMAC } = require('../routes/getMac');
const { addHotspotUser } = require('../routes/mikrotikConnect');

// POST: User chooses plan
router.post('/connect', async (req, res) => {
  const { planId, phone } = req.body;
  if (!planId || !phone) return res.status(400).json({ error: 'Plan and phone required' });

  try {
    const mac = getMAC(req);
    const plan = await HotspotPlan.findById(planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    // Generate user credentials
    const username = `HS${Date.now().toString().slice(-6)}`;
    const password = Math.random().toString(36).substring(2, 8);

    // Add to MikroTik
    await addHotspotUser({
      server: plan.mikrotikServer,
      profile: plan.mikrotikProfile,
      username,
      password,
      macAddress: mac,
    });
    
    const existing = await RegisteredHotspotUser.findOne({
  mac,
  expiresAt: { $gt: new Date() }
  });

  if (existing) {
  return res.status(409).json({ error: 'This device already has an active plan.' });
  }


    // Save to DB
    const access = new HotspotAccess({
      phone,
      macAddress: mac,
      planId,
      username,
      password,
      expiresAt: new Date(Date.now() + parseDuration(plan.duration)),
    });

    await access.save();

    res.json({ username, password, expiresAt: access.expiresAt });

  } catch (err) {
    console.error('Connection error:', err);
    res.status(500).json({ error: 'Failed to activate access' });
  }
});


exports.getAvailableHotspotPlans = async (req, res) => {
  try {
    const plans = await HotspotPlan.find({}); // filter based on active status if needed
    res.json(plans);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
};

exports.prepareCheckout = async (req, res) => {
  const { planId } = req.body;

  try {
    const plan = await HotspotPlan.findById(planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    res.json({
      name: plan.name,
      price: plan.price,
      speed: plan.rateLimit,
      validity: plan.duration,
      mikrotikProfile: plan.mikrotikProfile,
      mikrotikServer: plan.mikrotikServer,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch plan details' });
  }
};
exports.getReceipt = async (req, res) => {
  try {
    const user = await RegisteredHotspotUser.findOne({ transactionId: req.params.txnId }).populate('plan');
    if (!user) return res.status(404).json({ error: 'Receipt not found' });

    res.json({
      name: user.phone,
      mac: user.mac,
      plan: user.plan.name,
      amount: user.plan.price,
      validity: user.plan.duration,
      transactionId: user.transactionId,
      expiresAt: user.expiresAt,
      issuedAt: user.createdAt,
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not generate receipt' });
  }
};
// Parse "1d", "3h" → ms
function parseDuration(durationStr) {
  const match = durationStr.match(/^(\d+)([dhm])$/);
  if (!match) return 0;
  const [_, value, unit] = match;
  const multipliers = { d: 86400000, h: 3600000, m: 60000 };
  return parseInt(value) * multipliers[unit];
}

exports.confirmPaymentAndGrantAccess = async (req, res) => {
  const { mac, phone, planId, transactionId } = req.body;

  try {
    const plan = await HotspotPlan.findById(planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const expiresAt = new Date(Date.now() + parseDuration(plan.duration));

    // Add to MikroTik (replaces manual logic)
    await addHotspotUser({
      server: plan.mikrotikServer,
      profile: plan.mikrotikProfile,
      username: mac, // using MAC as username
      password: '',  // optional password
      macAddress: mac,
    });

    const user = await RegisteredHotspotUser.create({
      mac,
      phone,
      transactionId,
      plan: plan._id,
      expiresAt,
    });

    res.json({
      message: 'Access granted',
      username: mac,
      expiresAt,
      transactionId,
    });
  } catch (err) {
    console.error('Hotspot access error:', err);
    res.status(500).json({ error: 'Could not complete access' });
  }
};
