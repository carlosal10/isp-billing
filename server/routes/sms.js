const express = require('express');
const router = express.Router();
const SmsSettings = require('../models/SmsSettings');
const SmsTemplate = require('../models/SmsTemplate');
const { renderTemplate, formatDateISO } = require('../utils/template');
const { sendSms } = require('../utils/sms');
const Customer = require('../models/customers');
const Plan = require('../models/plan');
const { createPayLink } = require('../utils/paylink');

// GET settings (tenant scoped)
router.get('/settings', async (req, res) => {
  try {
    const doc = await SmsSettings.findOne({ tenantId: req.tenantId }).lean();
    res.json(doc || {});
  } catch (e) {
    console.error('sms settings get error', e);
    res.status(500).json({ error: 'Failed to load SMS settings' });
  }
});

// POST upsert settings
router.post('/settings', async (req, res) => {
  try {
    const update = { ...req.body, tenantId: req.tenantId };
    const doc = await SmsSettings.findOneAndUpdate({ tenantId: req.tenantId }, update, { upsert: true, new: true, setDefaultsOnInsert: true });
    res.json({ ok: true, settings: doc });
  } catch (e) {
    console.error('sms settings save error', e);
    res.status(500).json({ error: 'Failed to save SMS settings' });
  }
});

// List templates
router.get('/templates', async (req, res) => {
  try {
    const items = await SmsTemplate.find({ tenantId: req.tenantId }).lean();
    res.json(items);
  } catch (e) {
    console.error('sms templates list error', e);
    res.status(500).json({ error: 'Failed to list SMS templates' });
  }
});

// Upsert a template by (type, language)
router.post('/templates', async (req, res) => {
  try {
    const { type, language = 'en', body, active = true } = req.body || {};
    if (!type || !body) return res.status(400).json({ error: 'Missing type or body' });
    const doc = await SmsTemplate.findOneAndUpdate(
      { tenantId: req.tenantId, type, language },
      { $set: { body, active } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ ok: true, template: doc });
  } catch (e) {
    console.error('sms template upsert error', e);
    res.status(500).json({ error: 'Failed to save SMS template' });
  }
});

// Preview render
router.post('/preview', async (req, res) => {
  try {
    const { body, variables } = req.body || {};
    if (!body) return res.status(400).json({ error: 'Missing body' });
    return res.json({ rendered: renderTemplate(body, variables || {}) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to render preview' });
  }
});

// Send a test SMS using a template and a sample customer/plan (or custom body)
router.post('/send-test', async (req, res) => {
  try {
    const { to, templateType = 'payment-link', language = 'en', body: overrideBody, variables } = req.body || {};
    if (!to) return res.status(400).json({ error: 'Missing recipient phone' });

    const tmpl = await SmsTemplate.findOne({ tenantId: req.tenantId, type: templateType, language, active: true }).lean();
    const body = overrideBody || tmpl?.body || 'Hi {{name}}, your {{plan_name}} (KES {{amount}}) expires on {{expiry_date}}. Pay here: {{payment_link}}';

    // pick a random or first customer+plan for preview; but allow override via req
    const customer = await Customer.findOne({ tenantId: req.tenantId }).lean();
    const plan = customer?.plan ? await Plan.findOne({ _id: customer.plan, tenantId: req.tenantId }).lean() : await Plan.findOne({ tenantId: req.tenantId }).lean();
    const dueAt = new Date(Date.now() + 5 * 24 * 3600 * 1000);

    const { url } = await createPayLink({ tenantId: req.tenantId, customerId: customer?._id, planId: plan?._id, dueAt });

    const rendered = renderTemplate(body, {
      name: customer?.name || 'Customer',
      plan_name: plan?.name || 'Plan',
      amount: plan?.price != null ? String(plan.price) : '',
      expiry_date: formatDateISO(dueAt),
      payment_link: url,
      ...(variables || {}),
    });

    const resp = await sendSms(req.tenantId, to, rendered);
    res.json({ ok: true, id: resp.id, provider: resp.provider });
  } catch (e) {
    console.error('sms send-test error', e);
    res.status(500).json({ error: e.message || 'Failed to send test SMS' });
  }
});

// Send an SMS to a specific customer using a template and on-the-fly paylink
// Body: { customerId, planId?, templateType?, language?, dueAt? }
router.post('/send', async (req, res) => {
  try {
    const { customerId, planId, templateType = 'payment-link', language = 'en', dueAt } = req.body || {};
    if (!customerId) return res.status(400).json({ error: 'Missing customerId' });

    const customer = await Customer.findOne({ _id: customerId, tenantId: req.tenantId }).lean();
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    const plan = planId
      ? await Plan.findOne({ _id: planId, tenantId: req.tenantId }).lean()
      : (customer.plan ? await Plan.findOne({ _id: customer.plan, tenantId: req.tenantId }).lean() : null);
    if (!plan) return res.status(400).json({ error: 'Plan is required (customer has none assigned)' });

    const linkDue = dueAt ? new Date(dueAt) : new Date(Date.now() + 3 * 24 * 3600 * 1000);
    const { url } = await createPayLink({ tenantId: req.tenantId, customerId: customer._id, planId: plan._id, dueAt: linkDue });

    const tmpl = await SmsTemplate.findOne({ tenantId: req.tenantId, type: templateType, language, active: true }).lean();
    const body = tmpl?.body || 'Hi {{name}}, your {{plan_name}} (KES {{amount}}) expires on {{expiry_date}}. Pay: {{payment_link}}';

    const rendered = renderTemplate(body, {
      name: customer.name || 'Customer',
      plan_name: plan.name || 'Plan',
      amount: plan.price != null ? String(plan.price) : '',
      expiry_date: formatDateISO(linkDue),
      payment_link: url,
    });

    const resp = await sendSms(req.tenantId, customer.phone, rendered);
    res.json({ ok: true, id: resp.id, provider: resp.provider, to: customer.phone });
  } catch (e) {
    console.error('sms send error', e);
    res.status(500).json({ error: e.message || 'Failed to send SMS' });
  }
});

module.exports = router;
