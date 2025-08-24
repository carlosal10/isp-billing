const { sendSTKPush } = require('../utils/stkPush');
const { getISPSettings } = require('../models/MpesaConfig');
exports.initiateCheckout = async (req, res) => {
  const { phone, planId } = req.body;
  const mac = getMAC(req);
  try {
    const plan = await HotspotPlan.findById(planId);
    const isp = await getISPSettings(); // Custom function to fetch ISP's M-Pesa config

    const txn = await HotspotTransaction.create({
      phone, mac, plan: plan._id, status: 'pending'
    });

    const response = await sendSTKPush({
      phone,
      amount: plan.price,
      shortcode: isp.shortcode,
      passkey: isp.passkey,
      consumerKey: isp.consumerKey,
      consumerSecret: isp.consumerSecret,
      transactionId: txn._id.toString(),
      callbackUrl: 'https://yourdomain.com/api/mpesa/callback'
    });

    res.json({
      message: 'STK Push initiated',
      transactionId: txn._id,
      checkoutRequestID: response.CheckoutRequestID
    });
  } catch (err) {
    console.error('STK Checkout failed:', err);
    res.status(500).json({ error: 'Payment request failed' });
  }
};