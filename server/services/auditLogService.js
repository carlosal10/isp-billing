'use strict';

const AuditLog = require('../models/AuditLog');
const { redactObject } = require('./privacyService');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 250;

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseDate(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    date.setHours(23, 59, 59, 999);
  }
  return date;
}

function normalizeAuditLogQuery(query = {}) {
  const limit = clampNumber(query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const page = clampNumber(query.page, 1, 1, 10_000);
  const sort = String(query.sort || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  const action = String(query.action || '').trim();
  const actor = String(query.actor || '').trim();
  const routerHost = String(query.routerHost || '').trim();
  const q = String(query.q || query.search || '').trim();
  const from = parseDate(query.from || query.createdFrom || null);
  const to = parseDate(query.to || query.createdTo || null, true);

  return {
    limit,
    page,
    skip: (page - 1) * limit,
    sort,
    action,
    actor,
    routerHost,
    q,
    from,
    to,
  };
}

function buildAuditLogFilter(tenantId, normalized = {}) {
  const filter = { tenantId };
  if (normalized.action) filter.action = normalized.action;
  if (normalized.actor) filter.actor = new RegExp(escapeRegex(normalized.actor), 'i');
  if (normalized.routerHost) filter.routerHost = new RegExp(escapeRegex(normalized.routerHost), 'i');

  if (normalized.from || normalized.to) {
    filter.createdAt = {};
    if (normalized.from) filter.createdAt.$gte = normalized.from;
    if (normalized.to) filter.createdAt.$lte = normalized.to;
  }

  if (normalized.q) {
    const rx = new RegExp(escapeRegex(normalized.q), 'i');
    filter.$or = [
      { actor: rx },
      { action: rx },
      { routerHost: rx },
      { 'payload.accountNumber': rx },
      { 'payload.customerId': rx },
      { 'payload.invoiceId': rx },
      { 'payload.paymentId': rx },
      { 'payload.eventId': rx },
      { 'payload.job': rx },
      { 'payload.reason': rx },
      { 'payload.note': rx },
      { 'payload.error': rx },
    ];
  }

  return filter;
}

function redactPayload(value, depth = 0) {
  return redactObject(value, { maxDepth: 6, maxArrayLength: 100 }, depth);
}

function serializeAuditLog(entry = {}) {
  return {
    _id: String(entry._id),
    tenantId: entry.tenantId ? String(entry.tenantId) : null,
    createdAt: entry.createdAt || null,
    actor: entry.actor || null,
    action: entry.action || null,
    routerHost: entry.routerHost || null,
    payload: redactPayload(entry.payload || null),
  };
}

async function listAuditLogs(tenantId, query = {}) {
  const normalized = normalizeAuditLogQuery(query);
  const filter = buildAuditLogFilter(tenantId, normalized);
  const sort = { createdAt: normalized.sort === 'asc' ? 1 : -1, _id: normalized.sort === 'asc' ? 1 : -1 };

  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .sort(sort)
      .skip(normalized.skip)
      .limit(normalized.limit)
      .lean(),
    AuditLog.countDocuments(filter),
  ]);

  return {
    items: items.map(serializeAuditLog),
    total,
    page: normalized.page,
    limit: normalized.limit,
    hasMore: normalized.skip + items.length < total,
  };
}

async function listAuditActions(tenantId, query = {}) {
  const normalized = normalizeAuditLogQuery(query);
  const match = buildAuditLogFilter(tenantId, {
    ...normalized,
    action: '',
  });

  const rows = await AuditLog.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$action',
        count: { $sum: 1 },
        lastSeenAt: { $max: '$createdAt' },
      },
    },
    { $sort: { count: -1, _id: 1 } },
    { $limit: 200 },
  ]);

  return rows
    .filter((row) => row._id)
    .map((row) => ({
      action: row._id,
      count: row.count,
      lastSeenAt: row.lastSeenAt || null,
    }));
}

async function getAuditSummary(tenantId, query = {}) {
  const normalized = normalizeAuditLogQuery(query);
  const filter = buildAuditLogFilter(tenantId, normalized);
  const [totals] = await AuditLog.aggregate([
    { $match: filter },
    {
      $facet: {
        total: [{ $count: 'count' }],
        byAction: [
          { $group: { _id: '$action', count: { $sum: 1 }, lastSeenAt: { $max: '$createdAt' } } },
          { $sort: { count: -1, _id: 1 } },
          { $limit: 8 },
        ],
        byActor: [
          { $group: { _id: '$actor', count: { $sum: 1 }, lastSeenAt: { $max: '$createdAt' } } },
          { $sort: { count: -1, _id: 1 } },
          { $limit: 8 },
        ],
      },
    },
  ]);

  return {
    total: totals?.total?.[0]?.count || 0,
    byAction: (totals?.byAction || []).map((row) => ({
      action: row._id || 'unknown',
      count: row.count,
      lastSeenAt: row.lastSeenAt || null,
    })),
    byActor: (totals?.byActor || []).map((row) => ({
      actor: row._id || 'unknown',
      count: row.count,
      lastSeenAt: row.lastSeenAt || null,
    })),
  };
}

module.exports = {
  buildAuditLogFilter,
  getAuditSummary,
  listAuditActions,
  listAuditLogs,
  normalizeAuditLogQuery,
  redactPayload,
  serializeAuditLog,
};
