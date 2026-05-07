'use strict';

const MessageDelivery = require('../models/MessageDelivery');

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const SENSITIVE_CONTEXT_KEYS = [
  'apiKey',
  'authToken',
  'body',
  'key',
  'password',
  'payload',
  'pin',
  'raw',
  'secret',
  'token',
];

function toId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}

function toPlain(doc) {
  if (!doc) return null;
  return typeof doc.toObject === 'function' ? doc.toObject() : doc;
}

function truncate(value, max = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function parseLimit(value, defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultLimit;
  return Math.min(Math.floor(parsed), maxLimit);
}

function normalizeDeliveryStatus(value) {
  const status = String(value || '').toLowerCase().trim();
  if (['delivered', 'success'].includes(status)) return 'delivered';
  if (['sent', 'accepted', 'ok'].includes(status)) return 'sent';
  if (['failed', 'failure', 'error', 'rejected'].includes(status)) return 'failed';
  if (['skipped', 'disabled', 'suppressed'].includes(status)) return 'skipped';
  return 'queued';
}

function redactContext(value, depth = 0) {
  if (depth > 4) return '[MaxDepth]';
  if (value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactContext(item, depth + 1));
  if (typeof value !== 'object') return value;

  return Object.entries(value).reduce((acc, [key, item]) => {
    const lower = String(key).toLowerCase();
    if (SENSITIVE_CONTEXT_KEYS.some((needle) => lower.includes(needle))) {
      acc[key] = '[REDACTED]';
    } else {
      acc[key] = redactContext(item, depth + 1);
    }
    return acc;
  }, {});
}

function serializeMessageDelivery(delivery) {
  const doc = toPlain(delivery);
  if (!doc) return null;
  return {
    id: toId(doc._id),
    channel: doc.channel || 'sms',
    direction: doc.direction || 'outbound',
    provider: doc.provider || null,
    templateType: doc.templateType || null,
    language: doc.language || 'en',
    status: doc.status || 'queued',
    to: doc.to || null,
    normalizedTo: doc.normalizedTo || null,
    subject: doc.subject || null,
    bodyPreview: doc.bodyPreview || null,
    bodyLength: doc.bodyLength || 0,
    providerMessageId: doc.providerMessageId || null,
    providerStatus: doc.providerStatus || null,
    cost: doc.cost || null,
    customer: doc.customer
      ? {
          id: toId(doc.customer._id || doc.customer),
          name: doc.customer.name || null,
          accountNumber: doc.customer.accountNumber || null,
          phone: doc.customer.phone || null,
        }
      : null,
    plan: doc.plan
      ? {
          id: toId(doc.plan._id || doc.plan),
          name: doc.plan.name || null,
          price: doc.plan.price ?? null,
        }
      : null,
    errorMessage: doc.errorMessage || null,
    context: redactContext(doc.context || {}),
    sentAt: doc.sentAt || null,
    failedAt: doc.failedAt || null,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

async function recordMessageDelivery({
  tenantId,
  channel = 'sms',
  direction = 'outbound',
  provider = null,
  templateType = null,
  language = 'en',
  status = 'queued',
  to = null,
  normalizedTo = null,
  subject = null,
  body = null,
  providerMessageId = null,
  providerStatus = null,
  cost = null,
  customerId = null,
  planId = null,
  errorMessage = null,
  context = {},
} = {}) {
  if (!tenantId) return null;
  const normalizedStatus = normalizeDeliveryStatus(status);
  const now = new Date();
  const doc = await MessageDelivery.create({
    tenantId,
    channel,
    direction,
    provider,
    templateType,
    language,
    status: normalizedStatus,
    to,
    normalizedTo: normalizedTo || to,
    subject,
    bodyPreview: truncate(body),
    bodyLength: body ? String(body).length : 0,
    providerMessageId,
    providerStatus,
    cost: cost == null ? null : String(cost),
    customer: customerId || null,
    plan: planId || null,
    errorMessage: truncate(errorMessage, 500),
    context: redactContext(context || {}),
    sentAt: ['sent', 'delivered'].includes(normalizedStatus) ? now : null,
    failedAt: normalizedStatus === 'failed' ? now : null,
  });
  return serializeMessageDelivery(doc);
}

async function listMessageDeliveries(tenantId, options = {}) {
  const filter = { tenantId };
  if (options.channel) filter.channel = String(options.channel).trim();
  if (options.status) filter.status = normalizeDeliveryStatus(options.status);
  if (options.templateType) filter.templateType = String(options.templateType).trim();
  if (options.customerId) filter.customer = String(options.customerId).trim();

  const rows = await MessageDelivery.find(filter)
    .sort({ createdAt: -1 })
    .limit(parseLimit(options.limit))
    .populate('customer', 'name accountNumber phone')
    .populate('plan', 'name price')
    .lean();

  return rows.map(serializeMessageDelivery);
}

async function getMessageDeliverySummary(tenantId, options = {}) {
  const days = Math.min(Math.max(Number(options.days) || 30, 1), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const match = { tenantId, createdAt: { $gte: since } };

  const [byStatus, byProvider, recentFailures] = await Promise.all([
    MessageDelivery.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    MessageDelivery.aggregate([
      { $match: match },
      { $group: { _id: { provider: '$provider', channel: '$channel' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    MessageDelivery.find({ ...match, status: 'failed' })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('customer', 'name accountNumber phone')
      .lean(),
  ]);

  const counts = byStatus.reduce((acc, row) => {
    acc[row._id || 'unknown'] = row.count;
    return acc;
  }, {});

  return {
    days,
    total: Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0),
    queued: counts.queued || 0,
    sent: counts.sent || 0,
    delivered: counts.delivered || 0,
    failed: counts.failed || 0,
    skipped: counts.skipped || 0,
    byProvider: byProvider.map((row) => ({
      provider: row._id?.provider || 'unknown',
      channel: row._id?.channel || 'sms',
      count: row.count,
    })),
    recentFailures: recentFailures.map(serializeMessageDelivery),
  };
}

module.exports = {
  getMessageDeliverySummary,
  listMessageDeliveries,
  normalizeDeliveryStatus,
  parseLimit,
  recordMessageDelivery,
  redactContext,
  serializeMessageDelivery,
  truncate,
};
