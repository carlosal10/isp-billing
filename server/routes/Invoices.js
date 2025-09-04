const express = require('express');
const router = express.Router();
const Invoice = require('../models/Invoice');
const Customer = require('../models/customers');

router.get('/', async (req, res) => {
  try {
    const invoices = await Invoice.find({ tenantId: req.tenantId })
      .populate('customer', 'name accountNumber');
    const result = invoices.map(inv => ({
      ...inv.toObject(),
      customerName: inv.customer.name
    }));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});
router.put('/:id/pay', async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ _id: req.params.id, tenantId: req.tenantId })
      .populate('customer plan');
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    invoice.status = 'paid';
    await invoice.save();

    res.json({ message: 'Invoice marked as paid', invoice });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark invoice paid' });
  }
});
router.post('/:id/generate', async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ _id: req.params.id, tenantId: req.tenantId })
      .populate('customer plan');
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    // Logic to generate PDF or invoice number
    invoice.generated = true;
    await invoice.save();

    res.json({ message: 'Invoice generated', invoice });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate invoice' });
  }
});
const path = require('path');

router.get('/:id/pdf', async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    // Assuming PDFs are saved in /pdfs folder with invoice._id.pdf
    const pdfPath = path.join(__dirname, '../pdfs', `${invoice._id}.pdf`);
    res.sendFile(pdfPath);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch invoice PDF' });
  }
});

module.exports = router;
