'use strict';

const mongoose = require('mongoose');
const Customer = require('../models/customers');
const MessageCampaign = require('../models/MessageCampaign');
const PaymentConfig = require('../models/PaymentConfig');
const SmsTemplate = require('../models/SmsTemplate');
const { assessSmsPermission } = require('./customerCommunicationPreferencesService');
const { recordMessageDelivery, truncate } = require('./messageDeliveryService');
const { createPayLink } = require('../utils/paylink');
const { renderTemplate, buildTemplateVariables } = require('../utils/template');
const { sendSms, normalizePhone } = require('../utils/sms');

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const DEFAULT_TEMPLATE =
  'Hi {{name}}, important update from your ISP: {{message}}';
const FALLBACK_PAYBILL =
  process.env.MPESA_SHORTCODE ||
  process.env.MPESA_TILL ||
  process.env.PAYBILL_SHORTCODE ||
  null;

function serviceError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function actorId(actor = {}) {
  return String(actor.id || actor.email || actor.sub || actor._id || '').trim() || null;
}

function toId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}

function parseLimit(value, defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultLimit;
  return Math.min(Math.floor(parsed), maxLimit);
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeAudience(audience = {}) {
  const customerIds = Array.isArray(audience.customerIds)
    ? audience.customerIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  return {
    status: String(audience.status || '').trim(),
    connectionType: String(audience.connectionType || '').trim(),
    planId: String(audience.planId || '').trim(),
    query: String(audience.query || '').trim(),
    customerIds,
    limit: parseLimit(audience.limit),
  };
}

function normalizeCampaignPayload(payload = {}) {
  const audience = normalizeAudience(payload.audience || {});
  const body = String(payload.body || '').trim();
  const templateType = String(payload.templateType || 'broadcast').trim() || 'broadcast';
  const language = String(payload.language || 'en').trim().toLowerCase() || 'en';
  const category = String(payload.category || templateType || 'service').trim().toLowerCase();
  const name = String(payload.name || '').trim() || `${templateType} ${new Date().toISOString().slice(0, 10)}`;
  const includePaylink = payload.includePaylink === true;
  const dueAt = payload.dueAt ? new Date(payload.dueAt) : null;

  if (dueAt && !Number.isFinite(dueAt.getTime())) throw serviceError(400, 'dueAt must be a valid date');
  if (!body && !templateType) throw serviceError(400, 'body or templateType is required');

  return {
    name: name.slice(0, 120),
    templateType,
    language,
    category,
    body,
    audience,
    includePaylink,
    dueAt,
    message: String(payload.message || '').trim(),
  };
}

function buildAudienceFilter(tenantId, audience = {}) {
  const filter = { tenantId };
  if (audience.status) filter.status = audience.status;
  if (audience.connectionType) filter.connectionType = audience.connectionType;
  if (audience.planId) {
    if (!mongoose.isValidObjectId(audience.planId)) throw serviceError(400, 'Invalid plan id');
    filter.plan = audience.planId;
  }
  if (audience.customerIds.length) {
    const ids = audience.customerIds.filter((id) => mongoose.isValidObjectId(id));
    if (!ids.length) throw serviceError(400, 'Invalid customer ids');
    filter._id = { $in: ids };
  }
  if (audience.query) {
    const regex = new RegExp(escapeRegex(audience.query), 'i');
    filter.$or = [
      { name: regex },
      { accountNumber: regex },
      { email: regex },
      { phone: regex },
      { address: regex },
    ];
  }
  return filter;
}

function serializeCampaign(campaign = {}) {
  const doc = typeof campaign.toObject === 'function' ? campaign.toObject() : campaign;
  return {
    id: toId(doc._id),
    name: doc.name || null,
    channel: doc.channel || 'sms',
    status: doc.status || 'draft',
    templateType: doc.templateType || null,
    language: doc.language || 'en',
    category: doc.category || null,
    bodyPreview: doc.bodyPreview || null,
    audience: doc.audience || {},
    includePaylink: doc.includePaylink === true,
    dueAt: doc.dueAt || null,
    counts: doc.counts || {},
    createdBy: doc.createdBy || null,
    sentBy: doc.sentBy || null,
    sentAt: doc.sentAt || null,
    errorMessage: doc.errorMessage || null,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

async function resolveTenantPaybill(tenantId) {
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

async function loadTemplateBody(tenantId, templateType, language, fallbackBody) {
  if (fallbackBody) return fallbackBody;
  const template = await SmsTemplate.findOne({
    tenantId,
    type: templateType,
    language,
    active: true,
  }).lean();
  return template?.body || DEFAULT_TEMPLATE;
}

async function resolveRecipients(tenantId, audience = {}) {
  const normalized = normalizeAudience(audience);
  const customers = await Customer.find(buildAudienceFilter(tenantId, normalized))
    .select({ 'portalProfile.pinHash': 0 })
    .sort({ name: 1, accountNumber: 1 })
    .limit(normalized.limit)
    .populate('plan', 'name price duration speed rateLimit')
    .lean();

  return { customers, audience: normalized };
}

async function renderForCustomer({
  tenantId,
  customer,
  body,
  message,
  includePaylink,
  dueAt,
  paybill,
  preview = false,
}) {
  const plan = customer.plan || null;
  let paymentLink = '';
  const linkDue = dueAt || new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  if (includePaylink && plan?._id) {
    if (preview) {
      paymentLink = '[payment link generated at send time]';
    } else {
      const link = await createPayLink({
        tenantId,
        customerId: customer._id,
        planId: plan._id,
        dueAt: linkDue,
      });
      paymentLink = link?.url || '';
    }
  }

  const variables = buildTemplateVariables({
    customer,
    plan,
    expiryDate: linkDue,
    paymentLink,
    paybillShortcode: paybill.paybillShortcode,
    tillNumber: paybill.tillNumber,
  });

  return renderTemplate(body, {
    ...variables,
    message: message || '',
  });
}

function recipientDecision(customer, category) {
  if (!customer.phone) {
    return { allowed: false, reason: 'missing_phone' };
  }
  return assessSmsPermission(customer, { category });
}

async function previewCampaign({ tenantId, payload = {} }) {
  const normalized = normalizeCampaignPayload(payload);
  const [recipientResult, body, paybill] = await Promise.all([
    resolveRecipients(tenantId, normalized.audience),
    loadTemplateBody(tenantId, normalized.templateType, normalized.language, normalized.body),
    resolveTenantPaybill(tenantId),
  ]);

  const sample = [];
  const counts = {
    total: recipientResult.customers.length,
    sendable: 0,
    skipped: 0,
    missingPhone: 0,
  };

  for (const customer of recipientResult.customers) {
    const decision = recipientDecision(customer, normalized.category);
    if (decision.allowed) counts.sendable += 1;
    else {
      counts.skipped += 1;
      if (decision.reason === 'missing_phone') counts.missingPhone += 1;
    }

    if (sample.length < 10) {
      const rendered = await renderForCustomer({
        tenantId,
        customer,
        body,
        message: normalized.message,
        includePaylink: normalized.includePaylink,
        dueAt: normalized.dueAt,
        paybill,
        preview: true,
      });
      sample.push({
        customerId: String(customer._id),
        name: customer.name || null,
        accountNumber: customer.accountNumber || null,
        phone: customer.phone || null,
        allowed: decision.allowed,
        reason: decision.reason || null,
        messagePreview: truncate(rendered, 180),
      });
    }
  }

  return {
    campaign: {
      name: normalized.name,
      templateType: normalized.templateType,
      language: normalized.language,
      category: normalized.category,
      includePaylink: normalized.includePaylink,
      dueAt: normalized.dueAt,
      audience: recipientResult.audience,
    },
    counts,
    sample,
  };
}

async function sendCampaign({ tenantId, payload = {}, actor = {} }) {
  const normalized = normalizeCampaignPayload(payload);
  const [recipientResult, body, paybill] = await Promise.all([
    resolveRecipients(tenantId, normalized.audience),
    loadTemplateBody(tenantId, normalized.templateType, normalized.language, normalized.body),
    resolveTenantPaybill(tenantId),
  ]);

  const campaign = await MessageCampaign.create({
    tenantId,
    name: normalized.name,
    status: 'sending',
    templateType: normalized.templateType,
    language: normalized.language,
    category: normalized.category,
    bodyPreview: truncate(body, 180),
    audience: recipientResult.audience,
    includePaylink: normalized.includePaylink,
    dueAt: normalized.dueAt,
    counts: {
      total: recipientResult.customers.length,
      sendable: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      missingPhone: 0,
    },
    createdBy: actorId(actor),
  });

  const counts = { ...campaign.counts.toObject?.() || campaign.counts };
  const deliveryIds = [];

  for (const customer of recipientResult.customers) {
    const plan = customer.plan || null;
    const decision = recipientDecision(customer, normalized.category);
    const rendered = await renderForCustomer({
      tenantId,
      customer,
      body,
      message: normalized.message,
      includePaylink: normalized.includePaylink,
      dueAt: normalized.dueAt,
      paybill,
      preview: false,
    });

    if (!decision.allowed) {
      counts.skipped += 1;
      if (decision.reason === 'missing_phone') counts.missingPhone += 1;
      const delivery = await recordMessageDelivery({
        tenantId,
        channel: 'sms',
        provider: null,
        templateType: normalized.templateType,
        language: normalized.language,
        status: 'skipped',
        to: customer.phone || null,
        normalizedTo: customer.phone ? normalizePhone(customer.phone) : null,
        body: rendered,
        customerId: customer._id,
        planId: plan?._id || null,
        errorMessage: decision.reason,
        context: {
          mode: 'campaign',
          campaignId: String(campaign._id),
          category: normalized.category,
        },
      });
      if (delivery?.id) deliveryIds.push(delivery.id);
      continue;
    }

    counts.sendable += 1;
    try {
      const response = await sendSms(tenantId, customer.phone, rendered);
      counts.sent += 1;
      const delivery = await recordMessageDelivery({
        tenantId,
        channel: 'sms',
        provider: response?.provider || null,
        templateType: normalized.templateType,
        language: normalized.language,
        status: response?.status || 'sent',
        to: customer.phone,
        normalizedTo: normalizePhone(customer.phone),
        body: rendered,
        providerMessageId: response?.id || null,
        providerStatus: response?.status || null,
        cost: response?.cost || null,
        customerId: customer._id,
        planId: plan?._id || null,
        context: {
          mode: 'campaign',
          campaignId: String(campaign._id),
          category: normalized.category,
        },
      });
      if (delivery?.id) deliveryIds.push(delivery.id);
    } catch (err) {
      counts.failed += 1;
      const delivery = await recordMessageDelivery({
        tenantId,
        channel: 'sms',
        provider: null,
        templateType: normalized.templateType,
        language: normalized.language,
        status: 'failed',
        to: customer.phone,
        normalizedTo: normalizePhone(customer.phone),
        body: rendered,
        customerId: customer._id,
        planId: plan?._id || null,
        errorMessage: err?.message || 'SMS send failed',
        context: {
          mode: 'campaign',
          campaignId: String(campaign._id),
          category: normalized.category,
        },
      });
      if (delivery?.id) deliveryIds.push(delivery.id);
    }
  }

  campaign.counts = counts;
  campaign.deliveryIds = deliveryIds.filter((id) => mongoose.isValidObjectId(id));
  campaign.status = counts.failed > 0 && counts.sent > 0 ? 'partial' : counts.failed > 0 ? 'failed' : 'sent';
  campaign.sentAt = new Date();
  campaign.sentBy = actorId(actor);
  await campaign.save();

  return serializeCampaign(campaign);
}

async function listCampaigns(tenantId, options = {}) {
  const rows = await MessageCampaign.find({ tenantId })
    .sort({ createdAt: -1 })
    .limit(parseLimit(options.limit, 50, 200))
    .lean();
  return rows.map(serializeCampaign);
}

module.exports = {
  buildAudienceFilter,
  listCampaigns,
  normalizeAudience,
  normalizeCampaignPayload,
  parseLimit,
  previewCampaign,
  sendCampaign,
  serializeCampaign,
};
