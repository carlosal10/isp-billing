'use strict';

const net = require('net');
const Tenant = require('../models/Tenant');
const Customer = require('../models/customers');
const IpPool = require('../models/IpPool');
const IpAssignment = require('../models/IpAssignment');
const { normalizeIPv4, normalizeIpList, parseCidr, pickNextAvailableIp } = require('../services/ipamMath');

const LEGACY_COMPATIBILITY_KEY = 'tenant-static-ip-pool';
const LEGACY_COMPATIBILITY_NAME = 'Legacy Static Pool';

function getTenantIdValue(tenantOrId) {
  if (!tenantOrId) return null;
  if (typeof tenantOrId === 'string') return tenantOrId;
  if (typeof tenantOrId === 'object' && tenantOrId._id) return String(tenantOrId._id);
  return String(tenantOrId);
}

function isValidIPv4(ip) {
  try {
    return net.isIP(String(ip)) === 4;
  } catch {
    return false;
  }
}

async function getLegacyStaticIpPool(tenantId) {
  if (!tenantId) return null;
  return IpPool.findOne({
    tenantId,
    kind: 'static',
    allocationStrategy: 'list',
    'metadata.compatibilityKey': LEGACY_COMPATIBILITY_KEY,
  });
}

async function ensureLegacyStaticIpPool(tenantId, sourceList = null) {
  if (!tenantId) return null;
  const tenant =
    sourceList === null
      ? await Tenant.findById(tenantId).select({ staticIpPool: 1 }).lean()
      : null;
  const addressList = normalizeIpList(sourceList === null ? tenant?.staticIpPool || [] : sourceList);
  let pool = await getLegacyStaticIpPool(tenantId);

  if (!pool && addressList.length === 0) {
    return null;
  }

  if (!pool) {
    pool = new IpPool({
      tenantId,
      name: LEGACY_COMPATIBILITY_NAME,
      kind: 'static',
      allocationStrategy: 'list',
      addressList,
      status: addressList.length ? 'active' : 'disabled',
      metadata: {
        compatibilityKey: LEGACY_COMPATIBILITY_KEY,
        defaultForCustomerStatic: true,
        managedBy: 'tenant.staticIpPool',
      },
      notes: 'System-managed compatibility pool mirrored from tenant staticIpPool',
    });
  } else {
    pool.addressList = addressList;
    pool.status = addressList.length ? 'active' : 'disabled';
    pool.metadata = {
      ...(pool.metadata || {}),
      compatibilityKey: LEGACY_COMPATIBILITY_KEY,
      defaultForCustomerStatic: true,
      managedBy: 'tenant.staticIpPool',
    };
  }

  await pool.save();
  return pool;
}

function poolContainsIp(pool, ipAddress) {
  const ip = normalizeIPv4(ipAddress);
  if (!pool || !ip) return false;
  if (pool.allocationStrategy === 'list') {
    return Array.isArray(pool.addressList) && pool.addressList.includes(ip);
  }
  if (!pool.cidr) return false;
  try {
    return parseCidr(pool.cidr).contains(ip);
  } catch {
    return false;
  }
}

async function listStaticPoolsForTenant(tenantId, { activeOnly = true } = {}) {
  if (!tenantId) return [];
  await ensureLegacyStaticIpPool(tenantId).catch(() => null);
  const filter = { tenantId, kind: 'static' };
  if (activeOnly) filter.status = 'active';
  const pools = await IpPool.find(filter).sort({ createdAt: 1 }).lean();
  return pools.sort((a, b) => {
    const aDefault = a?.metadata?.defaultForCustomerStatic ? 1 : 0;
    const bDefault = b?.metadata?.defaultForCustomerStatic ? 1 : 0;
    return bDefault - aDefault;
  });
}

async function getDefaultStaticPool(tenantId) {
  const pools = await listStaticPoolsForTenant(tenantId, { activeOnly: true });
  if (!pools.length) return null;
  const explicitDefault = pools.find((pool) => pool?.metadata?.defaultForCustomerStatic === true);
  if (explicitDefault) return explicitDefault;
  if (pools.length === 1) return pools[0];
  return null;
}

async function resolveStaticPoolForIp(tenantId, ipAddress, { activeOnly = true } = {}) {
  const pools = await listStaticPoolsForTenant(tenantId, { activeOnly });
  const ip = normalizeIPv4(ipAddress);
  if (!ip) return null;
  return pools.find((pool) => poolContainsIp(pool, ip)) || null;
}

async function allocateIp(tenant) {
  const tenantId = getTenantIdValue(tenant);
  if (!tenantId) {
    throw new Error('staticIpPool not configured for this tenant');
  }
  const selected = await allocateFromPool(tenantId);
  if (!selected) {
    throw new Error('No available static IP address in pool');
  }
  return selected;
}

async function allocateFromPool(tenantId) {
  const pool = await getDefaultStaticPool(tenantId);
  if (!pool) return null;

  const [usedCustomerIps, activeAssignmentIps] = await Promise.all([
    Customer.distinct('staticConfig.ip', {
      tenantId,
      'staticConfig.ip': { $ne: null },
    }),
    IpAssignment.distinct('ipAddress', {
      tenantId,
      pool: pool._id,
      releasedAt: null,
    }),
  ]);

  return pickNextAvailableIp({
    cidr: pool,
    usedIps: [...(usedCustomerIps || []), ...(activeAssignmentIps || [])],
    excludedIps: pool.gateway ? [pool.gateway] : [],
  });
}

async function isIpInPool(tenantId, ip) {
  const norm = normalizeIPv4(ip);
  if (!norm) return false;

  const pools = await listStaticPoolsForTenant(tenantId, { activeOnly: true });
  if (pools.length === 0) {
    const tenant = await Tenant.findById(tenantId).select({ staticIpPool: 1 }).lean();
    const fallbackList = normalizeIpList(tenant?.staticIpPool || []);
    if (fallbackList.length === 0) return true;
    return fallbackList.includes(norm);
  }

  return pools.some((pool) => poolContainsIp(pool, norm));
}

async function ensureCustomerIpAssignment({
  tenantId,
  customerId,
  ipAddress,
  note = null,
}) {
  const norm = normalizeIPv4(ipAddress);
  if (!tenantId || !customerId || !norm) return null;

  const pool = await resolveStaticPoolForIp(tenantId, norm, { activeOnly: true });
  if (!pool) return null;

  const activeCustomerAssignments = await IpAssignment.find({
    tenantId,
    customer: customerId,
    purpose: 'customer-wan',
    releasedAt: null,
  });

  let matching = null;
  for (const assignment of activeCustomerAssignments) {
    if (String(assignment.ipAddress || '').trim() === norm) {
      matching = assignment;
      continue;
    }
    assignment.status = 'released';
    assignment.releasedAt = new Date();
    assignment.releasedReason = 'Replaced by newer static IP assignment';
    await assignment.save();
  }

  if (matching) {
    if (matching.pool?.toString() !== String(pool._id)) {
      matching.pool = pool._id;
    }
    if (note !== null) matching.note = note;
    if (matching.status !== 'allocated') matching.status = 'allocated';
    await matching.save();
    return matching;
  }

  const conflicting = await IpAssignment.findOne({
    tenantId,
    ipAddress: norm,
    releasedAt: null,
  });
  if (conflicting && String(conflicting.customer || '') !== String(customerId)) {
    throw new Error(`Static IP ${norm} is already allocated`);
  }
  if (conflicting) return conflicting;

  return IpAssignment.create({
    tenantId,
    pool: pool._id,
    ipAddress: norm,
    status: 'allocated',
    purpose: 'customer-wan',
    customer: customerId,
    note,
    allocatedAt: new Date(),
  });
}

async function releaseCustomerIpAssignment({
  tenantId,
  customerId = null,
  ipAddress = null,
  reason = 'Released from customer lifecycle',
}) {
  if (!tenantId) return 0;
  const filter = {
    tenantId,
    purpose: 'customer-wan',
    releasedAt: null,
  };
  if (customerId) filter.customer = customerId;
  if (ipAddress) filter.ipAddress = normalizeIPv4(ipAddress);

  const assignments = await IpAssignment.find(filter);
  for (const assignment of assignments) {
    assignment.status = 'released';
    assignment.releasedAt = new Date();
    assignment.releasedReason = reason;
    await assignment.save();
  }
  return assignments.length;
}

async function releaseIp(tenant, ipAddr) {
  const tenantId = getTenantIdValue(tenant);
  const ipAddress = normalizeIPv4(ipAddr);
  if (!tenantId || !ipAddress) return 0;
  return releaseCustomerIpAssignment({
    tenantId,
    ipAddress,
    reason: 'Static IP released',
  });
}

module.exports = {
  allocateIp,
  allocateFromPool,
  ensureCustomerIpAssignment,
  ensureLegacyStaticIpPool,
  getLegacyStaticIpPool,
  isValidIPv4,
  isIpInPool,
  releaseCustomerIpAssignment,
  releaseIp,
  resolveStaticPoolForIp,
};
