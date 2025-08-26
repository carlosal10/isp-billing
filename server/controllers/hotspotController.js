// controllers/hotspotController.js
const HotspotPlan = require('../models/HotspotPlan');
const RegisteredHotspotUser = require('../models/RegisteredHotspotUser');
const HotspotAccess = require('../models/HotspotAccess');

const { addHotspotUser } = require('../routes/mikrotikConnect');
const { getMAC } = require('../utils/getMac');

/**
 * Utility: Parse "1d", "3h", "30m" → ms
 */
function parseDuration(durationStr) {
  const match = durationStr.match(/^(\d+)([dhm])$/);
  if (!match) return 0;

  const [_, value, unit] = match;
  const multipliers = { d: 86400000, h: 3600000, m: 60000 };
  return parseInt(value, 10) * multipliers[unit];
}

/**
 * Grant Hotspot Access after purchase/checkout
 */
exports.connectHotspotUser = async (req, res) => {
  const { planId, phone } = req.body;
  if (!planId || !phone) {
    return res.status(400).json({ error: 'Plan ID and phone are required.' });
  }

  try {
    const mac = getMAC(req);
    if (!mac) return res.status(400).json({ error: 'MAC address not detected.' });

    const plan = await HotspotPlan.findById(planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });

    // Prevent overlapping active sessions for same MAC
    const existing = await RegisteredHotspotUser.findOne({
      mac,
      expiresAt: { $gt: new Date() }
    });
    if (existing) {
      return res.status(409).json({ error: 'This device already has an active plan.' });
    }

    // Generate random credentials
    const username = `HS${Date.now().toString().slice(-6)}`;
    const password = Math.random().toString(36).substring(2, 8);

    // Push user to MikroTik
    await addHotspotUser({
      server: plan.mikrotikServer,
      profile: plan.mikrotikProfile,
      username,
      password,
      macAddress: mac,
    });

    // Save access record
    const expiresAt = new Date(Date.now() + parseDuration(plan.duration));
    const access = await HotspotAccess.create({
      phone,
      macAddress: mac,
      planId,
      username,
      password,
      expiresAt,
    });

    res.json({
      username,
      password,
      expiresAt,
      plan: plan.name,
      message: 'Access granted successfully.'
    });

  } catch (err) {
    console.error('connectHotspotUser error:', err);
    res.status(500).json({ error: 'Failed to activate hotspot access.' });
  }
};

/**
 * Fetch all available plans
 */
exports.getAvailableHotspotPlans = async (req, res) => {
  try {
    const plans = await HotspotPlan.find({ isActive: true }); // optional filter
    res.json(plans);
  } catch (err) {
    console.error('getAvailableHotspotPlans error:', err);
    res.status(500).json({ error: 'Failed to fetch hotspot plans.' });
  }
};

/**
 * Prepare checkout with plan details
 */
exports.prepareCheckout = async (req, res) => {
  const { planId } = req.body;

  try {
    const plan = await HotspotPlan.findById(planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });

    res.json({
      name: plan.name,
      price: plan.price,
      speed: plan.rateLimit,
      validity: plan.duration,
      mikrotikProfile: plan.mikrotikProfile,
      mikrotikServer: plan.mikrotikServer,
    });
  } catch (err) {
    console.error('prepareCheckout error:', err);
    res.status(500).json({ error: 'Failed to fetch plan details.' });
  }
};

/**
 * Generate receipt for a transaction
 */
exports.getReceipt = async (req, res) => {
  try {
    const user = await RegisteredHotspotUser
      .findOne({ transactionId: req.params.txnId })
      .populate('plan');

    if (!user) return res.status(404).json({ error: 'Receipt not found.' });

    res.json({
      name: user.phone,
      mac: user.mac,
      plan: user.plan?.name,
      amount: user.plan?.price,
      validity: user.plan?.duration,
      transactionId: user.transactionId,
      expiresAt: user.expiresAt,
      issuedAt: user.createdAt,
    });
  } catch (err) {
    console.error('getReceipt error:', err);
    res.status(500).json({ error: 'Could not generate receipt.' });
  }
};

/**
 * Confirm payment → push user to MikroTik + persist in DB
 */
exports.confirmPaymentAndGrantAccess = async (req, res) => {
  const { mac, phone, planId, transactionId } = req.body;

  if (!mac || !phone || !planId || !transactionId) {
    return res.status(400).json({ error: 'MAC, phone, planId and transactionId are required.' });
  }

  try {
    const plan = await HotspotPlan.findById(planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });

    const expiresAt = new Date(Date.now() + parseDuration(plan.duration));

    // Add user to MikroTik (using MAC as username for easy login)
    await addHotspotUser({
      server: plan.mikrotikServer,
      profile: plan.mikrotikProfile,
      username: mac,
      password: '',
      macAddress: mac,
    });

    // Save user
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
    console.error('confirmPaymentAndGrantAccess error:', err);
    res.status(500).json({ error: 'Could not complete access.' });
  }
};
