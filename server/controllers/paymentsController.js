// paymentController.js
const Payment = require('../models/Payment');
const Customer = require('../models/customers');
const Plan = require('../models/plan');
const { initiateSTKPush } = require('../utils/mpesa');
const { createStripePaymentIntent } = require('../utils/stripe');
const { applyBandwidthQueue } = require('../utils/bandwidthManager');

// --- Initiate Payment ---
exports.initiatePayment = async (req, res) => {
    const { customerId, provider, amount, phone, transactionId } = req.body;

    if (!customerId || !provider || (!amount && provider !== 'manual')) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const customer = await Customer.findById(customerId).populate('plan');
        if (!customer) return res.status(404).json({ error: 'Customer not found' });

        let paymentEntry = await Payment.create({
            accountNumber: customer.accountNumber,
            phoneNumber: phone || customer.phone,
            customer: customer._id,
            amount: amount || customer.plan.price,
            transactionId: transactionId || null,
            provider: provider.toLowerCase(),
            status: 'Pending'
        });

        switch (provider.toLowerCase()) {
            case 'mpesa':
                const stkResponse = await initiateSTKPush({
                    ispId: customer._id,
                    amount: paymentEntry.amount,
                    phone: phone || customer.phone,
                    accountReference: paymentEntry._id.toString(),
                    callbackURL: `${process.env.BASE_URL}/api/payment/callback`
                });
                try {
                    const checkoutRequestId = stkResponse?.CheckoutRequestID;
                    const merchantRequestId = stkResponse?.MerchantRequestID;
                    if (checkoutRequestId || merchantRequestId) {
                        await Payment.updateOne(
                            { _id: paymentEntry._id },
                            { $set: { checkoutRequestId: checkoutRequestId || undefined, merchantRequestId: merchantRequestId || undefined } }
                        );
                    }
                } catch (e) {
                    console.warn('[payments] could not persist STK ids:', e?.message || e);
                }
                return res.json({ payment: paymentEntry, providerResponse: stkResponse });

            case 'stripe':
                const stripeIntent = await createStripePaymentIntent(
                    paymentEntry.amount,
                    customer.accountNumber
                );
                return res.json({ payment: paymentEntry, providerResponse: stripeIntent });

            case 'manual':
                paymentEntry.status = 'Success';
                await paymentEntry.save();

                await applyBandwidthQueue(customer, customer.plan);
                return res.json({ message: 'Manual payment applied', payment: paymentEntry });

            default:
                return res.status(400).json({ error: 'Unsupported payment provider' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Payment initiation failed', details: err.message });
    }
};

// --- Payment Callback (M-Pesa, Stripe webhooks standardised) ---
exports.paymentCallback = async (req, res) => {
    const { accountReference, transactionId, status } = req.body;

    try {
        const payment = await Payment.findOne({ accountNumber: accountReference });
        if (!payment) return res.status(404).json({ error: 'Payment record not found' });

        payment.transactionId = transactionId || payment.transactionId;
        payment.status = status === 'Success' ? 'Success' : 'Failed';
        await payment.save();

        if (payment.status === 'Success') {
            const customer = await Customer.findById(payment.customer).populate('plan');
            await applyBandwidthQueue(customer, customer.plan);
        }

        res.json({ message: 'Payment processed successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Payment callback failed', details: err.message });
    }
};

// --- Get Payment Status for a customer ---
exports.getPaymentStatus = async (req, res) => {
    try {
        const payments = await Payment.find({ customer: req.params.customerId });
        res.json(payments);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch payment status' });
    }
};
