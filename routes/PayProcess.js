const express = require('express');
const axios = require('axios');
const Payment = require('../models/Payment');
const Customer = require('../models/customers');
const router = express.Router();

// Environment variables
const {
    MPESA_CONSUMER_KEY,
    MPESA_CONSUMER_SECRET,
    MPESA_SHORTCODE,
    MPESA_PASSKEY,
    MPESA_ENV,
    MPESA_CALLBACK_URL
} = process.env;

// M-Pesa API Base URL
const MPESA_BASE_URL =
    MPESA_ENV === 'sandbox'
        ? 'https://sandbox.safaricom.co.ke'
        : 'https://api.safaricom.co.ke';

// Generate OAuth Token
async function getOAuthToken() {
    const auth = Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString('base64');
    const response = await axios.get(`${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
        headers: { Authorization: `Basic ${auth}` }
    });
    return response.data.access_token;
}


// Initiate STK Push
router.post('/stkpush', async (req, res) => {
    const { phoneNumber, amount, accountNumber } = req.body;

    if (!phoneNumber || !amount || !accountNumber) {
        return res.status(400).json({ message: 'Phone number, amount, and account number are required.' });
    }

    try {
        // Validate customer and amount
        const customer = await Customer.findOne({ accountNumber }).populate('plan');
        if (!customer) {
            return res.status(404).json({ message: 'Customer not found.' });
        }

        if (customer.plan.price > amount) {
            return res.status(400).json({
                message: `Amount is less than the required plan price of ${customer.plan.price}`
            });
        }

        const token = await getOAuthToken();

        const timestamp = new Date().toISOString().replace(/[-:.T]/g, '').slice(0, 14);
        const password = Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`).toString('base64');

        const requestData = {
            BusinessShortCode: MPESA_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: amount,
            PartyA: phoneNumber,
            PartyB: MPESA_SHORTCODE,
            PhoneNumber: phoneNumber,
            CallBackURL: MPESA_CALLBACK_URL,
            AccountReference: accountNumber,
            TransactionDesc: 'Payment for Internet services'
        };

        const response = await axios.post(
            `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
            requestData,
            { headers: { Authorization: `Bearer ${token}` } }
        );

        // Save payment to database
        const payment = new Payment({
            accountNumber,
            phoneNumber,
            amount,
            customer: customer._id,
            status: 'Pending'
        });
        await payment.save();

        res.json({
            message: 'STK Push initiated',
            response: response.data
        });
    } catch (err) {
        console.error('Error initiating STK Push:', err.message);
        res.status(500).json({ message: 'Failed to initiate STK Push', error: err.message });
    }
});

// Callback URL to handle M-Pesa STK Push Response
router.post('/callback', async (req, res) => {
    console.log('M-Pesa Callback:', JSON.stringify(req.body));

    try {
        const { Body } = req.body;

        if (Body.stkCallback.ResultCode === 0) {
            // Successful transaction
            const transaction = Body.stkCallback.CallbackMetadata.Item;

            const phoneNumber = transaction.find(item => item.Name === 'PhoneNumber').Value;
            const transactionId = transaction.find(item => item.Name === 'MpesaReceiptNumber').Value;

            const payment = await Payment.findOneAndUpdate(
                { phoneNumber, status: 'Pending' },
                { transactionId, status: 'Success' },
                { new: true }
            );

            if (payment) {
                console.log('Payment updated successfully:', payment);
            } else {
                console.log('Payment record not found for the callback phoneNumber.');
            }
        } else {
            // Transaction failed
            console.log('Payment failed:', Body.stkCallback.ResultDesc);

            // Update payment status to failed
            const phoneNumber = Body.stkCallback.CallbackMetadata?.Item?.find(
                item => item.Name === 'PhoneNumber'
            )?.Value;

            if (phoneNumber) {
                await Payment.findOneAndUpdate(
                    { phoneNumber, status: 'Pending' },
                    { status: 'Failed' }
                );
            }
        }

        res.status(200).json({ message: 'Callback processed successfully' });
    } catch (err) {
        console.error('Error processing callback:', err.message);
        res.status(500).json({ message: 'Error processing callback', error: err.message });
    }
});

module.exports = router;
