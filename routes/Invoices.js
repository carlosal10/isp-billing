const express = require('express');
const router = express.Router();
const Invoice = require('../models/Invoice');
const Customer = require('../models/customers');

// Get all invoices
router.get('/', async (req, res) => {
    try {
        const invoices = await Invoice.find()
            .populate('customer', 'name email')
            .populate('plan', 'name price');
        res.json(invoices);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Get invoices by customer
router.get('/customer/:customerId', async (req, res) => {
    try {
        const invoices = await Invoice.find({ customer: req.params.customerId })
            .populate('plan', 'name price');
        res.json(invoices);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Get a specific invoice
router.get('/:id', async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.id)
            .populate('customer', 'name email')
            .populate('plan', 'name price');
        if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
        res.json(invoice);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Create a new invoice
router.post('/', async (req, res) => {
    const { customer, plan, amountDue, dueDate } = req.body;

    try {
        const invoice = new Invoice({
            customer,
            plan,
            amountDue,
            dueDate,
        });

        const newInvoice = await invoice.save();
        res.status(201).json(newInvoice);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Update an invoice
router.put('/:id', async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.id);
        if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

        Object.assign(invoice, req.body); // Merge updates
        const updatedInvoice = await invoice.save();
        res.json(updatedInvoice);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Delete an invoice
router.delete('/:id', async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.id);
        if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

        await invoice.remove();
        res.json({ message: 'Invoice deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
