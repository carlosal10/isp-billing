'use strict';

const crypto = require('crypto');
const PaymentGatewayEvent = require('../models/PaymentGatewayEvent');

const PROCESSING_STALE_MS = 5 * 60 * 1000;
const HEADER_ALLOWLIST = [
  'content-type',
  'host',
  'user-agent',
  'x-forwarded-for',
  'x-forwarded-proto',
  'stripe-signature',
];

function normalizeId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && typeof value.toString === 'function') return value.toString();
  return String(value);
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashValue(value) {
  const input = Buffer.isBuffer(value)
    ? value
    : Buffer.from(typeof value === 'string' ? value : stableStringify(value), 'utf8');
  return crypto.createHash('sha256').update(input).digest('hex');
}

function buildHeaderSnapshot(headers = {}) {
  const snapshot = {};
  for (const name of HEADER_ALLOWLIST) {
    const value = headers?.[name];
    if (value == null) continue;
    snapshot[name] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return snapshot;
}

async function recordGatewayEvent(meta = {}) {
  const now = new Date();
  const base = {
    provider: meta.provider,
    kind: meta.kind,
    eventType: meta.eventType || null,
    dedupeKey: meta.dedupeKey,
    tenantId: meta.tenantId || null,
    paymentId: meta.paymentId || null,
    sourcePath: meta.sourcePath || null,
    externalId: meta.externalId || null,
    externalRef: meta.externalRef || null,
    transactionId: meta.transactionId || null,
    accountNumber: meta.accountNumber || null,
    phoneNumber: meta.phoneNumber || null,
    amount: Number.isFinite(Number(meta.amount)) ? Number(meta.amount) : null,
    currency: meta.currency || null,
    resultCode: Number.isFinite(Number(meta.resultCode)) ? Number(meta.resultCode) : null,
    resultDesc: meta.resultDesc || null,
    matchedBy: meta.matchedBy || null,
    eventStatus: meta.eventStatus || 'received',
    processingError: meta.processingError || null,
    firstSeenAt: now,
    lastSeenAt: now,
    payload: meta.payload ?? null,
    headers: meta.headers ?? null,
  };

  try {
    const event = await PaymentGatewayEvent.create(base);
    return { event, isDuplicate: false };
  } catch (err) {
    if (err?.code !== 11000) throw err;
    const event = await PaymentGatewayEvent.findOneAndUpdate(
      { dedupeKey: base.dedupeKey },
      {
        $set: {
          lastSeenAt: now,
          headers: base.headers,
          payload: base.payload,
        },
        $inc: { duplicateCount: 1 },
      },
      { new: true }
    );
    return { event, isDuplicate: true };
  }
}

async function beginGatewayEventProcessing(eventId) {
  return PaymentGatewayEvent.findByIdAndUpdate(
    eventId,
    {
      $set: {
        eventStatus: 'processing',
        processingError: null,
        processingStartedAt: new Date(),
      },
      $inc: { attemptCount: 1 },
    },
    { new: true }
  );
}

async function finalizeGatewayEvent(eventId, patch = {}) {
  const eventStatus = patch.eventStatus || 'processed';
  const update = {
    eventStatus,
    processingError: patch.processingError || null,
    tenantId: patch.tenantId || null,
    paymentId: patch.paymentId || null,
    matchedBy: patch.matchedBy || null,
    sourcePath: patch.sourcePath || null,
    externalId: patch.externalId || null,
    externalRef: patch.externalRef || null,
    transactionId: patch.transactionId || null,
    accountNumber: patch.accountNumber || null,
    phoneNumber: patch.phoneNumber || null,
    amount: Number.isFinite(Number(patch.amount)) ? Number(patch.amount) : null,
    currency: patch.currency || null,
    resultCode: Number.isFinite(Number(patch.resultCode)) ? Number(patch.resultCode) : null,
    resultDesc: patch.resultDesc || null,
    handledAt: new Date(),
    lastSeenAt: new Date(),
  };

  if (patch.payload !== undefined) update.payload = patch.payload;
  if (patch.headers !== undefined) update.headers = patch.headers;

  return PaymentGatewayEvent.findByIdAndUpdate(
    eventId,
    {
      $set: update,
      $unset: { processingStartedAt: 1 },
    },
    { new: true }
  );
}

function shouldSkipDuplicate(event) {
  if (!event) return false;
  if (event.eventStatus === 'processed') {
    return true;
  }
  if (event.eventStatus === 'processing' && event.processingStartedAt) {
    const startedAt = new Date(event.processingStartedAt).getTime();
    if (Number.isFinite(startedAt) && Date.now() - startedAt < PROCESSING_STALE_MS) {
      return true;
    }
  }
  return false;
}

async function listGatewayEvents(tenantId, options = {}) {
  const limit = Math.min(Number(options.limit) || 50, 200);
  const filter = { tenantId };
  if (options.provider) filter.provider = String(options.provider);
  if (options.kind) filter.kind = String(options.kind);
  if (options.eventStatus) filter.eventStatus = String(options.eventStatus);
  if (options.paymentId) filter.paymentId = String(options.paymentId);

  return PaymentGatewayEvent.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

module.exports = {
  hashValue,
  buildHeaderSnapshot,
  recordGatewayEvent,
  beginGatewayEventProcessing,
  finalizeGatewayEvent,
  shouldSkipDuplicate,
  listGatewayEvents,
  normalizeId,
};
