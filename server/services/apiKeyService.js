'use strict';

const crypto = require('crypto');
const ApiKey = require('../models/ApiKey');
const AuditLog = require('../models/AuditLog');
const { hashKey } = require('../middleware/apiKey');

const API_KEY_SCOPES = [
  { key: 'customers:read', label: 'Read Customers', description: 'Read customer profiles, account numbers, and service metadata.' },
  { key: 'customers:write', label: 'Write Customers', description: 'Create or update customer records.' },
  { key: 'invoices:read', label: 'Read Invoices', description: 'Read invoice status, balances, and billing metadata.' },
  { key: 'payments:read', label: 'Read Payments', description: 'Read payment records, gateway references, and statuses.' },
  { key: 'payments:write', label: 'Write Payments', description: 'Create payment requests or post external payment updates.' },
  { key: 'support:write', label: 'Write Support', description: 'Create support tickets or customer service requests.' },
  { key: 'network:read', label: 'Read Network', description: 'Read service/network status for operational integrations.' },
];

const DEFAULT_SCOPES = ['customers:read', 'invoices:read', 'payments:read'];

function serviceError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function actorId(actor = {}) {
  return String(actor.id || actor.email || actor.sub || actor._id || '').trim() || null;
}

function scopeSet() {
  return new Set(API_KEY_SCOPES.map((scope) => scope.key));
}

function normalizeScopes(scopes) {
  const allowed = scopeSet();
  const input = Array.isArray(scopes) && scopes.length ? scopes : DEFAULT_SCOPES;
  const normalized = [];
  for (const value of input) {
    const scope = String(value || '').trim().toLowerCase();
    if (!scope) continue;
    if (!allowed.has(scope)) {
      throw serviceError(400, `Unsupported API key scope: ${scope}`);
    }
    if (!normalized.includes(scope)) normalized.push(scope);
  }
  if (!normalized.length) {
    throw serviceError(400, 'At least one API key scope is required');
  }
  return normalized;
}

function parseExpiry(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw serviceError(400, 'expiresAt must be a valid date');
  }
  if (date <= new Date()) {
    throw serviceError(400, 'expiresAt must be in the future');
  }
  return date;
}

function generateRawKey() {
  return `sk_live_${crypto.randomBytes(32).toString('base64url')}`;
}

function keyPrefix(rawKey) {
  return String(rawKey || '').slice(0, 16);
}

function serializeApiKey(doc = {}) {
  const expiresAt = doc.expiresAt || null;
  const expired = expiresAt ? new Date(expiresAt) <= new Date() : false;
  return {
    id: String(doc._id),
    label: doc.label || 'API Key',
    description: doc.description || '',
    prefix: doc.prefix || null,
    active: doc.active === true && !expired,
    storedActive: doc.active === true,
    scopes: Array.isArray(doc.scopes) ? doc.scopes : [],
    lastUsedAt: doc.lastUsedAt || null,
    expiresAt,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
    createdBy: doc.createdBy || null,
    revokedAt: doc.revokedAt || null,
    revokedBy: doc.revokedBy || null,
    revokeReason: doc.revokeReason || null,
    isExpired: expired,
  };
}

async function logAudit({ tenantId, actor, action, payload }) {
  if (!tenantId) return null;
  return AuditLog.create({
    tenantId,
    actor: actorId(actor),
    action,
    routerHost: null,
    payload,
  }).catch(() => null);
}

async function listApiKeys(tenantId) {
  const rows = await ApiKey.find({ tenantId }).sort({ createdAt: -1 }).lean();
  return rows.map(serializeApiKey);
}

async function createApiKey({ tenantId, payload = {}, actor = {} }) {
  const label = String(payload.label || '').trim() || 'API Key';
  const description = String(payload.description || '').trim().slice(0, 500);
  const scopes = normalizeScopes(payload.scopes);
  const expiresAt = parseExpiry(payload.expiresAt || null);
  const raw = generateRawKey();
  const prefix = keyPrefix(raw);

  const doc = await ApiKey.create({
    tenantId,
    label,
    description,
    prefix,
    keyHash: hashKey(raw),
    scopes,
    active: true,
    expiresAt,
    createdBy: actorId(actor),
  });

  await logAudit({
    tenantId,
    actor,
    action: 'api_key.create',
    payload: {
      apiKeyId: String(doc._id),
      label,
      prefix,
      scopes,
      expiresAt,
    },
  });

  return {
    apiKey: serializeApiKey(doc),
    plaintextKey: raw,
  };
}

async function updateApiKey({ tenantId, apiKeyId, payload = {}, actor = {} }) {
  const doc = await ApiKey.findOne({ _id: apiKeyId, tenantId });
  if (!doc) throw serviceError(404, 'API key not found');
  if (doc.active !== true) throw serviceError(409, 'Revoked API keys cannot be updated');

  const previous = serializeApiKey(doc);
  if (payload.label !== undefined) {
    doc.label = String(payload.label || '').trim() || doc.label || 'API Key';
  }
  if (payload.description !== undefined) {
    doc.description = String(payload.description || '').trim().slice(0, 500);
  }
  if (payload.scopes !== undefined) {
    doc.scopes = normalizeScopes(payload.scopes);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'expiresAt')) {
    doc.expiresAt = payload.expiresAt ? parseExpiry(payload.expiresAt) : null;
  }

  await doc.save();
  const updated = serializeApiKey(doc);

  await logAudit({
    tenantId,
    actor,
    action: 'api_key.update',
    payload: {
      apiKeyId: String(doc._id),
      prefix: doc.prefix || null,
      before: {
        label: previous.label,
        description: previous.description,
        scopes: previous.scopes,
        expiresAt: previous.expiresAt,
      },
      after: {
        label: updated.label,
        description: updated.description,
        scopes: updated.scopes,
        expiresAt: updated.expiresAt,
      },
    },
  });

  return updated;
}

async function revokeApiKey({ tenantId, apiKeyId, actor = {}, reason = null }) {
  const doc = await ApiKey.findOne({ _id: apiKeyId, tenantId });
  if (!doc) throw serviceError(404, 'API key not found');
  if (doc.active !== true) return serializeApiKey(doc);

  doc.active = false;
  doc.revokedAt = new Date();
  doc.revokedBy = actorId(actor);
  doc.revokeReason = String(reason || '').trim().slice(0, 500) || null;
  await doc.save();

  await logAudit({
    tenantId,
    actor,
    action: 'api_key.revoke',
    payload: {
      apiKeyId: String(doc._id),
      label: doc.label || null,
      prefix: doc.prefix || null,
      reason: doc.revokeReason,
    },
  });

  return serializeApiKey(doc);
}

function listApiKeyScopes() {
  return API_KEY_SCOPES;
}

module.exports = {
  API_KEY_SCOPES,
  DEFAULT_SCOPES,
  createApiKey,
  listApiKeyScopes,
  listApiKeys,
  normalizeScopes,
  parseExpiry,
  revokeApiKey,
  serializeApiKey,
  updateApiKey,
};
