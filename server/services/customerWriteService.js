const Customer = require("../models/customers");
const Tenant = require("../models/Tenant");
const Plan = require("../models/plan");
const SmsSettings = require("../models/SmsSettings");
const SmsTemplate = require("../models/SmsTemplate");
const { sanitizeAliases } = require("./customerHelpers");
const { deriveAccountCode, deriveFullAddressCode } = require("../utils/accountNumber");
const { createPayLink } = require("../utils/paylink");
const { renderTemplate, formatDateISO } = require("../utils/template");
const { sendSms, normalizePhone } = require("../utils/sms");
const { createProrationAdjustmentForPlanChange } = require("./billingFinanceService");
const {
  assessSmsPermission,
  normalizeCommunicationPreferences,
} = require("./customerCommunicationPreferencesService");
const { recordMessageDelivery } = require("./messageDeliveryService");

function serviceError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function randomAccountNumber() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from(
    { length: 10 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

async function generateAccountNumber({ tenantId, address, name, phone }) {
  try {
    const tenant = await Tenant.findById(tenantId).lean();
    const prefix = String(tenant?.accountPrefix || "").trim();
    const baseSource = address || name || phone || "CUST";
    const baseCode = prefix
      ? deriveAccountCode(baseSource)
      : deriveFullAddressCode(baseSource);

    let candidate = `${prefix}${baseCode}`;
    let attempt = 0;

    while (attempt < 5) {
      const exists = await Customer.findOne({
        tenantId,
        accountNumber: candidate,
      })
        .select("_id")
        .lean();
      if (!exists) return candidate;

      attempt += 1;
      const suffix = `-${attempt + 1}`;
      candidate = `${prefix}${baseCode}`.slice(0, Math.max(1, 16 - suffix.length)) + suffix;
    }

    return randomAccountNumber();
  } catch {
    return randomAccountNumber();
  }
}

async function maybeSendPaylinkSms({ tenantId, customer, plan, onPlanChange = false }) {
  const smsCfg = await SmsSettings.findOne({ tenantId }).lean();
  const shouldSend =
    smsCfg?.enabled &&
    (onPlanChange ? smsCfg?.autoSendOnPlanChange : smsCfg?.autoSendOnCreate);

  if (!shouldSend) return;

  const templateType = smsCfg?.autoTemplateType || "payment-link";
  const tmpl = await SmsTemplate.findOne({
    tenantId,
    type: templateType,
    active: true,
  }).lean();

  const body =
    tmpl?.body ||
    "Hi {{name}}, your {{plan_name}} (KES {{amount}}). Pay: {{payment_link}}";

  const dueAt = new Date(Date.now() + 3 * 24 * 3600 * 1000);
  const { url } = await createPayLink({
    tenantId,
    customerId: customer._id,
    planId: plan._id,
    dueAt,
  });

  const rendered = renderTemplate(body, {
    name: customer.name || "Customer",
    plan_name: plan.name || "Plan",
    amount: String(plan.price ?? ""),
    expiry_date: formatDateISO(dueAt),
    payment_link: url,
  });

  if (customer.phone) {
    const permission = assessSmsPermission(customer, {
      category: templateType || "payment-link",
    });

    if (!permission.allowed) {
      await recordMessageDelivery({
        tenantId,
        channel: "sms",
        provider: null,
        templateType,
        language: customer.communicationPreferences?.preferredLanguage || "en",
        status: "skipped",
        to: customer.phone,
        normalizedTo: normalizePhone(customer.phone),
        body: rendered,
        customerId: customer._id,
        planId: plan._id,
        errorMessage: permission.reason,
        context: {
          mode: onPlanChange ? "auto-plan-change" : "auto-create",
          reason: permission.reason,
        },
      }).catch(() => null);
      return;
    }

    try {
      const response = await sendSms(tenantId, customer.phone, rendered);
      await recordMessageDelivery({
        tenantId,
        channel: "sms",
        provider: response?.provider || null,
        templateType,
        language: customer.communicationPreferences?.preferredLanguage || "en",
        status: response?.status || "sent",
        to: customer.phone,
        normalizedTo: normalizePhone(customer.phone),
        body: rendered,
        providerMessageId: response?.id || null,
        providerStatus: response?.status || null,
        cost: response?.cost || null,
        customerId: customer._id,
        planId: plan._id,
        context: {
          mode: onPlanChange ? "auto-plan-change" : "auto-create",
        },
      }).catch(() => null);
    } catch (err) {
      await recordMessageDelivery({
        tenantId,
        channel: "sms",
        provider: null,
        templateType,
        language: customer.communicationPreferences?.preferredLanguage || "en",
        status: "failed",
        to: customer.phone,
        normalizedTo: normalizePhone(customer.phone),
        body: rendered,
        customerId: customer._id,
        planId: plan._id,
        errorMessage: err?.message || "SMS send failed",
        context: {
          mode: onPlanChange ? "auto-plan-change" : "auto-create",
        },
      }).catch(() => null);
      throw err;
    }
  }
}

async function resolvePlan(tenantId, planId) {
  const plan = await Plan.findOne({ _id: planId, tenantId });
  if (!plan) throw serviceError(400, "Invalid plan selected");
  return plan;
}

// Customer identity and billing are saved independently of router availability.
async function createCustomer({ tenantId, payload = {} }) {
  if (payload.pppoeConfig !== undefined || payload.staticConfig !== undefined || payload.routerIp !== undefined) throw serviceError(409, 'Save billing details without router settings, then add or link a network service');
  const { name, email, phone, address, plan: planId, connectionType = 'pppoe', billingProfile, communicationPreferences } = payload;
  if (!['pppoe', 'static', 'hotspot'].includes(connectionType)) throw serviceError(400, 'Invalid connection type');
  const plan = await resolvePlan(tenantId, planId);
  const accountNumber = payload.accountNumber?.trim() || await generateAccountNumber({ tenantId, address, name, phone });
  const saved = await Customer.create({ tenantId, name, email, phone, address, accountNumber, plan: planId,
    connectionType, status: 'inactive', networkWorkflowVersion: 2,
    accountAliases: sanitizeAliases(payload.accountAliases, accountNumber), billingProfile,
    ...(communicationPreferences ? { communicationPreferences: normalizeCommunicationPreferences(communicationPreferences) } : {}) });
  try { await maybeSendPaylinkSms({ tenantId, customer: saved, plan }); }
  catch { console.warn('Customer paylink notification failed'); }
  return saved;
}
async function updateCustomer({ tenantId, customerId, payload = {} }) {
  let oldPlan;
  const updated = await require('./financialTransaction').financialTransaction(async () => {
    const c = await Customer.findOneAndUpdate({ _id: customerId, tenantId }, { $inc: { __v: 1 } }, { new: true });
    if (!c) throw serviceError(404, 'Customer not found');
    if (c.status === 'archived') throw serviceError(409, 'Archived customers cannot be edited');
    if (payload.pppoeConfig !== undefined || payload.staticConfig !== undefined || payload.routerIp !== undefined) throw serviceError(409, 'Manage router settings through the linked service');
    if (payload.connectionType && !['pppoe', 'static', 'hotspot'].includes(payload.connectionType)) throw serviceError(400, 'Invalid connection type');
    const Assignment = require('../models/NetworkAssignment');
    if (payload.connectionType && payload.connectionType !== c.connectionType &&
      (await Assignment.exists({ tenantId, customerId, status: { $ne: 'released' } }) || (c.networkWorkflowVersion !== 2 && (c.pppoeConfig?.profile || c.staticConfig?.ip)))) {
      throw serviceError(409, 'Release or migrate existing services before changing the connection type');
    }
    if (payload.status !== undefined && !['active', 'inactive'].includes(payload.status)) throw serviceError(400, 'Choose active or inactive billing status');
    oldPlan = String(c.plan || '');
    if (payload.plan !== undefined) { await resolvePlan(tenantId, payload.plan); c.plan = payload.plan; }
    const previousAccount = c.accountNumber;
    for (const key of ['name', 'email', 'phone', 'address', 'connectionType', 'status']) if (payload[key] !== undefined) c[key] = payload[key];
    if (payload.accountNumber !== undefined) {
      if (!String(payload.accountNumber).trim()) throw serviceError(400, 'Account number cannot be empty');
      c.accountNumber = String(payload.accountNumber).trim();
    }
    c.accountAliases = sanitizeAliases([...(payload.accountAliases || c.accountAliases || []), ...(previousAccount !== c.accountNumber ? [previousAccount] : [])], c.accountNumber);
    if (payload.billingProfile !== undefined) c.billingProfile = { ...(c.billingProfile?.toObject?.() || c.billingProfile || {}), ...payload.billingProfile };
    await c.save();
    if (payload.status !== undefined) {
      const { synchronizeBilling, isBillable } = require('./subscriberAccessService');
      await synchronizeBilling(c, isBillable(c));
    }
    if (String(c.plan || '') !== oldPlan) await createProrationAdjustmentForPlanChange({ tenantId, customerId: c._id, oldPlanId: oldPlan || null, newPlanId: c.plan, currentExpiryDate: c.expiryDate || null });
    return c;
  });
  if (String(updated.plan || '') !== oldPlan) {
    try { await maybeSendPaylinkSms({ tenantId, customer: updated, plan: await resolvePlan(tenantId, updated.plan), onPlanChange: true }); }
    catch { console.warn('Customer plan notification failed'); }
  }
  return updated;
}
async function deleteCustomer({ tenantId, customerId }) {
  return require('./financialTransaction').financialTransaction(async () => {
    const c = await Customer.findOneAndUpdate({ _id: customerId, tenantId }, { $inc: { __v: 1 } }, { new: true });
    if (!c) throw serviceError(404, 'Customer not found');
    const Assignment = require('../models/NetworkAssignment');
    if (await Assignment.exists({ tenantId, customerId, status: { $ne: 'released' } })) throw serviceError(409, 'Release all services and confirm router removal before archiving this customer');
    if (c.networkWorkflowVersion !== 2 && (c.pppoeConfig?.profile || c.staticConfig?.ip) && !await Assignment.exists({ tenantId, customerId })) throw serviceError(409, 'Link and release the existing router service before archiving this legacy customer');
    c.status = 'archived'; await c.save(); return c;
  });
}
module.exports = { createCustomer, updateCustomer, deleteCustomer };
