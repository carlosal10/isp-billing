// controllers/hotspotController.js
const HotspotPlan = require('../models/HotspotPlan');
const RegisteredHotspotUser = require('../models/RegisteredHotspotUser');
const HotspotAccess = require('../models/HotspotAccess');

const { ensureHotspotUser } = require('../utils/mikrotik');
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

    const plan = await HotspotPlan.findOne({ _id: planId, tenantId: req.tenantId });
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });

    // Prevent overlapping active sessions for same MAC
    const existing = await RegisteredHotspotUser.findOne({
      tenantId: req.tenantId,
      mac,
      expiresAt: { $gt: new Date() }
    });
    if (existing) {
      return res.status(409).json({ error: 'This device already has an active plan.' });
    }

    // Generate random credentials
    const username = `HS${Date.now().toString().slice(-6)}`;
    const password = Math.random().toString(36).substring(2, 8);

    // Push user to MikroTik (tenant-scoped)
    await ensureHotspotUser(String(req.tenantId), {
      server: plan.mikrotikServer,
      profile: plan.mikrotikProfile,
      username,
      password,
      macAddress: mac,
      comment: `Hotspot ${phone}`,
    });

    // Save access record
    const expiresAt = new Date(Date.now() + parseDuration(plan.planDuration));
    const access = await HotspotAccess.create({
      tenantId: req.tenantId,
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
      plan: plan.planName,
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
    const plans = await HotspotPlan.find({ tenantId: req.tenantId }).sort({ createdAt: -1 });
    res.json(plans.map((p) => ({
      _id: p._id,
      name: p.planName,
      price: p.planPrice,
      duration: p.planDuration,
      speed: p.planSpeed,
      server: p.mikrotikServer,
      profile: p.mikrotikProfile,
    })));
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
    const plan = await HotspotPlan.findOne({ _id: planId, tenantId: req.tenantId });
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });

    res.json({
      name: plan.planName,
      price: plan.planPrice,
      speed: plan.planSpeed,
      validity: plan.planDuration,
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
      .findOne({ tenantId: req.tenantId, transactionId: req.params.txnId })
      .populate('plan');

    if (!user) return res.status(404).json({ error: 'Receipt not found.' });

    res.json({
      name: user.phone,
      mac: user.mac,
      plan: user.plan?.planName,
      amount: user.plan?.planPrice,
      validity: user.plan?.planDuration,
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
    const plan = await HotspotPlan.findOne({ _id: planId, tenantId: req.tenantId });
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });

    const expiresAt = new Date(Date.now() + parseDuration(plan.planDuration));

    // Add user to MikroTik (using MAC as username for easy login)
    await ensureHotspotUser(String(req.tenantId), {
      server: plan.mikrotikServer,
      profile: plan.mikrotikProfile,
      username: mac,
      password: '',
      macAddress: mac,
      comment: `Hotspot ${phone}`,
    });

    // Save user
    const user = await RegisteredHotspotUser.create({
      tenantId: req.tenantId,
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
