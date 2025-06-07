// controllers/hotspotController.js
const HotspotPlan = require('../models/HotspotPlan');
const RegisteredHotspotUser = require('../models/RegisteredHotspotUser');
const { connectToMikroTik } = require('../routes/mikrotikConnect');

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

    const expiryDate = new Date(Date.now() + parseDuration(plan.duration));

    // Save access record
    const user = await RegisteredHotspotUser.create({
      mac,
      phone,
      transactionId,
      plan: plan._id,
      expiresAt: expiryDate,
    });

    // Grant access via MikroTik
    const api = await connectToMikroTik();
    await api.write('/ip/hotspot/user/add', [
      `=name=${mac}`,
      `=mac-address=${mac}`,
      `=server=${plan.mikrotikServer}`,
      `=profile=${plan.mikrotikProfile}`,
    ]);
    await api.close();

    res.json({
      message: 'Access granted',
      username: mac,
      password: '', // Password can be static or generated
      expiresAt: expiryDate,
      transactionId,
    });
  } catch (err) {
    console.error('Hotspot access error:', err);
    res.status(500).json({ error: 'Could not complete access' });
  }
};