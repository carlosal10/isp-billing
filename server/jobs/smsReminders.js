const cron = require('node-cron');
const Payment = require('../models/Payment');
const Customer = require('../models/customers');
const Plan = require('../models/plan');
const SmsTemplate = require('../models/SmsTemplate');
const SmsSettings = require('../models/SmsSettings');
const ReminderLog = require('../models/ReminderLog');
const { createPayLink } = require('../utils/paylink');
const { renderTemplate, formatDateISO } = require('../utils/template');
const { sendSms } = require('../utils/sms');

let running = false;

function daysBetween(a, b) {
  const ms = new Date(a).getTime() - new Date(b).getTime();
  return ms / (24 * 3600 * 1000);
}

function truncDate(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

async function getTemplate(tenantId, type, fallback) {
  const doc = await SmsTemplate.findOne({ tenantId, type, active: true }).lean();
  return doc?.body || fallback;
}

async function processTenantReminders(now) {
  // Fetch latest successful payments per customer with expiryDate
  const agg = await Payment.aggregate([
    { $match: { status: 'Success', expiryDate: { $ne: null } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: { tenantId: '$tenantId', customer: '$customer' }, expiryDate: { $first: '$expiryDate' }, tenantId: { $first: '$tenantId' }, customer: { $first: '$customer' }, plan: { $first: '$plan' } } },
  ]);

  const byTenant = new Map();
  for (const row of agg) {
    const arr = byTenant.get(String(row.tenantId)) || [];
    arr.push(row);
    byTenant.set(String(row.tenantId), arr);
  }

  for (const [tenantId, items] of byTenant.entries()) {
    const settings = await SmsSettings.findOne({ tenantId }).lean();
    if (!settings?.enabled) continue; // SMS disabled for tenant

    const dueWarnHours = settings?.schedule?.dueWarnHours ?? 4;

    for (const row of items) {
      const { customer, plan, expiryDate } = row;
      if (!expiryDate) continue;
      const dleft = daysBetween(expiryDate, now);

      let type = null;
      if (Math.floor(dleft) === 5 && settings?.schedule?.reminder5Days) type = 'T-5';
      else if (Math.floor(dleft) === 3 && settings?.schedule?.reminder3Days) type = 'T-3';
      else if (dleft >= 0 && dleft <= (dueWarnHours / 24)) type = 'T-0';

      if (!type) continue;

      const dueDateKey = truncDate(expiryDate);
      const exists = await ReminderLog.findOne({ tenantId, customerId: customer, type, dueDate: dueDateKey });
      if (exists) continue; // already sent

      const [custDoc, planDoc] = await Promise.all([
        Customer.findById(customer).lean(),
        Plan.findById(plan).lean(),
      ]);
      if (!custDoc || !planDoc) continue;

      const { url } = await createPayLink({ tenantId, customerId: customer, planId: plan, dueAt: expiryDate });

      let templateBody = 'Hi {{name}}, your {{plan_name}} (KES {{amount}}) expires on {{expiry_date}}. Pay now: {{payment_link}}';
      if (type === 'T-5') templateBody = await getTemplate(tenantId, 'reminder-5', templateBody);
      else if (type === 'T-3') templateBody = await getTemplate(tenantId, 'reminder-3', templateBody);
      else if (type === 'T-0') templateBody = await getTemplate(tenantId, 'reminder-0', 'Final notice: {{plan_name}} for {{name}} expires today ({{expiry_date}}). Pay: {{payment_link}}');

      const msg = renderTemplate(templateBody, {
        name: custDoc.name || 'Customer',
        plan_name: planDoc.name || 'Plan',
        amount: String(planDoc.price ?? ''),
        expiry_date: formatDateISO(expiryDate),
        payment_link: url,
      });

      try {
        const resp = await sendSms(tenantId, custDoc.phone, msg);
        await ReminderLog.create({ tenantId, customerId: customer, type, dueDate: dueDateKey, phone: custDoc.phone, messageId: resp.id, provider: resp.provider, status: 'sent' });
      } catch (e) {
        await ReminderLog.create({ tenantId, customerId: customer, type, dueDate: dueDateKey, phone: custDoc.phone, status: 'failed', error: e.message });
      }
    }
  }
}

// Run once daily at 09:00 Nairobi time
cron.schedule('0 9 * * *', async () => {
  if (running) return;
  running = true;
  const now = new Date();
  try {
    await processTenantReminders(now);
  } catch (e) {
    console.error('sms reminders job error', e);
  } finally {
    running = false;
  }
}, { timezone: 'Africa/Nairobi' });

console.log('SMS reminder job scheduled (09:00 Africa/Nairobi)');

module.exports = {};

