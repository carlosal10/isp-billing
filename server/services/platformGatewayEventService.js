'use strict';

const PaymentGatewayEvent = require('../models/PaymentGatewayEvent');
const PlatformGatewayEventAction = require('../models/PlatformGatewayEventAction');
const Payment = require('../models/Payment');
const Tenant = require('../models/Tenant');
const Customer = require('../models/customers');

const HOUR_MS = 60 * 60 * 1000;

function orphanFilter(extra = {}) {
  return {
    $and: [
      { $or: [{ tenantId: null }, { tenantId: { $exists: false } }] },
      extra,
    ],
  };
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasQueueOwnerExpression() {
  return {
    $ne: [{ $ifNull: ['$queueOwner', ''] }, ''],
  };
}

function buildOrphanQuery(options = {}, actor = null) {
  const filter = {};
  if (options.provider) filter.provider = String(options.provider);
  if (options.kind) filter.kind = String(options.kind);
  if (options.eventStatus) filter.eventStatus = String(options.eventStatus);

  const claimState = String(options.claimState || 'all').trim().toLowerCase();
  if (claimState === 'claimed') {
    filter.queueOwner = { $type: 'string', $ne: '' };
  } else if (claimState === 'unclaimed') {
    filter.$or = [
      { queueOwner: null },
      { queueOwner: '' },
      { queueOwner: { $exists: false } },
    ];
  } else if (claimState === 'mine' && actor) {
    filter.queueOwner = String(actor);
  }

  return orphanFilter(filter);
}

function computeQueueAgeMeta(event = {}) {
  const baseTime = event.firstSeenAt || event.createdAt || null;
  const ageMs = baseTime ? Math.max(Date.now() - new Date(baseTime).getTime(), 0) : null;
  const ageHours = ageMs == null ? null : Number((ageMs / HOUR_MS).toFixed(2));
  let ageBucket = 'fresh';
  if (ageMs != null && ageMs >= 72 * HOUR_MS) ageBucket = '72h+';
  else if (ageMs != null && ageMs >= 24 * HOUR_MS) ageBucket = '24h+';

  return {
    queueAgeMs: ageMs,
    queueAgeHours: ageHours,
    queueAgeBucket: ageBucket,
    isClaimed: Boolean(event.queueOwner),
  };
}

function enrichQueueEvent(event) {
  if (!event) return event;
  return {
    ...event,
    ...computeQueueAgeMeta(event),
  };
}

function sortForQueue(sort = '') {
  return String(sort || '').toLowerCase() === 'newest'
    ? { firstSeenAt: -1, createdAt: -1 }
    : { firstSeenAt: 1, createdAt: 1 };
}

async function listOrphanGatewayEvents(options = {}, actor = null) {
  const limit = Math.min(Number(options.limit) || 100, 200);
  const rows = await PaymentGatewayEvent.find(buildOrphanQuery(options, actor))
    .select({ payload: 0, headers: 0 })
    .sort(sortForQueue(options.sort))
    .limit(limit)
    .lean();

  return rows.map(enrichQueueEvent);
}

async function getOrphanGatewayEvent(eventId) {
  const event = await PaymentGatewayEvent.findOne(orphanFilter({ _id: eventId })).lean();
  return enrichQueueEvent(event);
}

async function getOrphanGatewayEventSummary(options = {}, actor = null) {
  const match = buildOrphanQuery(options, actor);
  const stale24hBefore = new Date(Date.now() - 24 * HOUR_MS);
  const stale72hBefore = new Date(Date.now() - 72 * HOUR_MS);

  const [totals] = await PaymentGatewayEvent.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        claimed: {
          $sum: {
            $cond: [hasQueueOwnerExpression(), 1, 0],
          },
        },
        stale24h: {
          $sum: {
            $cond: [{ $lte: ['$firstSeenAt', stale24hBefore] }, 1, 0],
          },
        },
        stale72h: {
          $sum: {
            $cond: [{ $lte: ['$firstSeenAt', stale72hBefore] }, 1, 0],
          },
        },
      },
    },
  ]);

  const byStatusRows = await PaymentGatewayEvent.aggregate([
    { $match: match },
    { $group: { _id: '$eventStatus', count: { $sum: 1 } } },
  ]);

  const byProviderRows = await PaymentGatewayEvent.aggregate([
    { $match: match },
    { $group: { _id: '$provider', count: { $sum: 1 } } },
  ]);

  return {
    total: totals?.total || 0,
    claimed: totals?.claimed || 0,
    unclaimed: Math.max((totals?.total || 0) - (totals?.claimed || 0), 0),
    stale24h: totals?.stale24h || 0,
    stale72h: totals?.stale72h || 0,
    byStatus: Object.fromEntries(
      byStatusRows
        .filter((row) => row?._id)
        .map((row) => [String(row._id), Number(row.count) || 0])
    ),
    byProvider: Object.fromEntries(
      byProviderRows
        .filter((row) => row?._id)
        .map((row) => [String(row._id), Number(row.count) || 0])
    ),
  };
}

async function findTenantById(tenantId) {
  return Tenant.findById(tenantId).lean();
}

async function searchTenants(query) {
  const q = String(query || '').trim();
  if (!q) return [];

  const regex = new RegExp(q, 'i');
  return Tenant.find(
    {
      $or: [{ name: regex }, { subdomain: regex }],
    },
    { name: 1, subdomain: 1 }
  )
    .sort({ name: 1 })
    .limit(20)
    .lean();
}

async function searchTenantPayments({ tenantId, query, provider } = {}) {
  const q = String(query || '').trim();
  if (!tenantId || !q) return [];

  const regex = new RegExp(escapeRegex(q), 'i');
  const matchingCustomers = await Customer.find(
    {
      tenantId,
      $or: [
        { name: regex },
        { email: regex },
        { phone: regex },
        { accountNumber: regex },
      ],
    },
    { _id: 1 }
  )
    .limit(25)
    .lean();

  const customerIds = matchingCustomers.map((customer) => customer._id);
  const filter = {
    tenantId,
    isDeleted: { $ne: true },
    $or: [
      { accountNumber: regex },
      { phoneNumber: regex },
      { transactionId: regex },
      { notes: regex },
    ],
  };

  if (customerIds.length) {
    filter.$or.push({ customer: { $in: customerIds } });
  }

  if (/^[a-f\d]{24}$/i.test(q)) {
    filter.$or.push({ _id: q });
  }

  if (provider === 'stripe') {
    filter.method = 'stripe';
  } else if (provider === 'mpesa') {
    filter.method = 'mpesa';
  }

  const payments = await Payment.find(filter)
    .sort({ createdAt: -1 })
    .limit(25)
    .populate('customer plan')
    .lean();

  return payments.map((payment) => ({
    _id: payment._id,
    transactionId: payment.transactionId || null,
    accountNumber: payment.accountNumber || null,
    phoneNumber: payment.phoneNumber || null,
    amount: payment.amount ?? null,
    status: payment.status || null,
    method: payment.method || null,
    validatedAt: payment.validatedAt || null,
    createdAt: payment.createdAt || null,
    customerName: payment.customer?.name || null,
    customerEmail: payment.customer?.email || null,
    planName: payment.plan?.name || null,
  }));
}

async function searchTenantCustomers({ tenantId, query } = {}) {
  const q = String(query || '').trim();
  if (!tenantId || !q) return [];

  const regex = new RegExp(escapeRegex(q), 'i');
  const customers = await Customer.find(
    {
      tenantId,
      $or: [
        { name: regex },
        { email: regex },
        { phone: regex },
        { accountNumber: regex },
        { accountAliases: regex },
      ],
    },
    { name: 1, email: 1, phone: 1, accountNumber: 1 }
  )
    .sort({ name: 1 })
    .limit(25)
    .lean();

  return customers.map((customer) => ({
    _id: customer._id,
    name: customer.name || null,
    email: customer.email || null,
    phone: customer.phone || null,
    accountNumber: customer.accountNumber || null,
  }));
}

async function claimOrphanGatewayEvent({ eventId, actor, actorDisplay = null }) {
  return PaymentGatewayEvent.findOneAndUpdate(
    orphanFilter({
      _id: eventId,
      $or: [
        { queueOwner: null },
        { queueOwner: '' },
        { queueOwner: { $exists: false } },
        { queueOwner: actor },
      ],
    }),
    {
      $set: {
        queueOwner: actor,
        queueOwnerDisplay: actorDisplay || actor,
        queueClaimedAt: new Date(),
        queueReleasedAt: null,
        queueReleasedBy: null,
        lastSeenAt: new Date(),
      },
    },
    { new: true }
  ).lean();
}

async function releaseOrphanGatewayEvent({ eventId, actor, actorDisplay = null }) {
  return PaymentGatewayEvent.findOneAndUpdate(
    orphanFilter({
      _id: eventId,
      $or: [
        { queueOwner: actor },
        { queueOwner: null },
        { queueOwner: '' },
        { queueOwner: { $exists: false } },
      ],
    }),
    {
      $set: {
        queueOwner: null,
        queueOwnerDisplay: null,
        queueClaimedAt: null,
        queueReleasedAt: new Date(),
        queueReleasedBy: actorDisplay || actor || null,
        lastSeenAt: new Date(),
      },
    },
    { new: true }
  ).lean();
}

async function adoptOrphanGatewayEvent({ eventId, tenantId }) {
  return PaymentGatewayEvent.findOneAndUpdate(
    orphanFilter({ _id: eventId }),
    {
      $set: {
        tenantId,
        lastSeenAt: new Date(),
      },
    },
    { new: true }
  ).lean();
}

async function listPlatformGatewayEventActions({ eventId, limit = 50 } = {}) {
  return PlatformGatewayEventAction.find({ eventId })
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 50, 200))
    .lean();
}

async function logPlatformGatewayEventAction({
  eventId,
  actor,
  actorDisplay = null,
  action,
  note = null,
  ok = true,
  payload = null,
}) {
  if (!eventId || !action) return null;
  return PlatformGatewayEventAction.create({
    eventId,
    actor: actor || null,
    actorDisplay: actorDisplay || actor || null,
    action,
    note: note || null,
    ok: ok !== false,
    payload: payload || null,
  }).catch(() => null);
}

module.exports = {
  listOrphanGatewayEvents,
  getOrphanGatewayEvent,
  getOrphanGatewayEventSummary,
  findTenantById,
  searchTenants,
  searchTenantPayments,
  searchTenantCustomers,
  claimOrphanGatewayEvent,
  releaseOrphanGatewayEvent,
  adoptOrphanGatewayEvent,
  listPlatformGatewayEventActions,
  logPlatformGatewayEventAction,
};
