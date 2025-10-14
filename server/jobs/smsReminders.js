const { scheduleJob } = require('../utils/scheduler');
const Payment = require('../models/Payment');
const Customer = require('../models/customers');
const Plan = require('../models/plan');
const SmsTemplate = require('../models/SmsTemplate');
const SmsSettings = require('../models/SmsSettings');
const ReminderLog = require('../models/ReminderLog');
const { createPayLink } = require('../utils/paylink');
const { renderTemplate, buildTemplateVariables } = require('../utils/template');
const { sendSms } = require('../utils/sms');
const { mark } = require('../utils/heartbeats');
const PaymentConfig = require('../models/PaymentConfig');

const FALLBACK_PAYBILL =
  process.env.MPESA_SHORTCODE ||
  process.env.MPESA_TILL ||
  process.env.PAYBILL_SHORTCODE ||
  null;

async function resolvePaybillForTenant(tenantId) {
  if (!tenantId) return { paybillShortcode: FALLBACK_PAYBILL, tillNumber: null };
  const config = await PaymentConfig.findOne({ ispId: String(tenantId), provider: 'mpesa' }).lean();
  const payMethod = (config?.payMethod || '').toLowerCase();
  const tillNumber = config?.buyGoodsTill || null;
  const paybillShortcode =
    payMethod === 'buygoods'
      ? tillNumber || config?.paybillShortcode || FALLBACK_PAYBILL
      : config?.paybillShortcode || tillNumber || FALLBACK_PAYBILL;
  return { paybillShortcode: paybillShortcode || FALLBACK_PAYBILL, tillNumber };
}

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
    const { paybillShortcode, tillNumber } = await resolvePaybillForTenant(tenantId);

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
      if (!custDoc || !planDoc || !custDoc.phone) continue;

      const { url } = await createPayLink({ tenantId, customerId: customer, planId: plan, dueAt: expiryDate });

      let templateBody = 'Dear Customer your internet subscription plan [Plan Name] will expire on [Expiry Date].\\nRenew early to stay connected.\\n\\nKindly make payments through our PayBill [PayBill Shortcode] your account number [Customer\'s Account Number] or click on the payment link below: [Payment Link]';
      if (type === 'T-5') templateBody = await getTemplate(tenantId, 'reminder-5', templateBody);
      else if (type === 'T-3') templateBody = await getTemplate(tenantId, 'reminder-3', '[Customer Name], your [Plan Name] plan ([Price], [Plan Speed]) is expiring on [Expiry Date]. PayBill [PayBill Shortcode] • Account [Customer\'s Account Number] • [Payment Link]');
      else if (type === 'T-0') templateBody = await getTemplate(tenantId, 'reminder-0', 'Final notice: [Customer Name], your [Plan Name] plan ([Price]) expires today ([Expiry Date]). PayBill [PayBill Shortcode] • Account [Customer\'s Account Number] • [Payment Link]');

      const variables = buildTemplateVariables({
        customer: custDoc,
        plan: planDoc,
        expiryDate,
        paymentLink: url,
        paybillShortcode,
        tillNumber,
      });
      const msg = renderTemplate(templateBody, variables);

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
scheduleJob({ name: 'smsReminders', cronExpr: '0 9 * * *', task: async () => {
  if (running) return;
  running = true;
  const now = new Date();
  try {
    await processTenantReminders(now);
    return { ok: true };
  } catch (e) {
    console.error('sms reminders job error', e);
    throw e;
  } finally {
    running = false;
  }
} });

console.log('SMS reminder job scheduled (09:00 Africa/Nairobi)');

module.exports = {};

