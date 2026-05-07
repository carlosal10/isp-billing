'use strict';

const AuditLog = require('../models/AuditLog');
const Customer = require('../models/customers');
const InventoryAsset = require('../models/InventoryAsset');
const IpAssignment = require('../models/IpAssignment');
const IpPool = require('../models/IpPool');
const {
  normalizeIPv4,
  parseCidr,
  pickNextAvailableIp,
  poolUsageFromAssignments,
} = require('./ipamMath');

function serviceError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function toId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}

function requestActor(actor) {
  return actor?.id || actor?.email || actor?.name || null;
}

async function logAudit(tenantId, actor, action, payload = {}) {
  if (!tenantId) return null;
  return AuditLog.create({
    tenantId,
    actor: requestActor(actor),
    action,
    routerHost: null,
    payload,
  }).catch(() => null);
}

function normalizeDnsServers(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  return list
    .map((entry) => normalizeIPv4(entry))
    .filter(Boolean);
}

function normalizeAssetPayload(payload = {}) {
  return {
    assetTag: payload.assetTag ? String(payload.assetTag).trim().toUpperCase() : '',
    name: payload.name ? String(payload.name).trim() : '',
    kind: payload.kind ? String(payload.kind).trim() : 'cpe',
    status: payload.status ? String(payload.status).trim() : 'in_stock',
    vendor: payload.vendor ? String(payload.vendor).trim() : null,
    model: payload.model ? String(payload.model).trim() : null,
    serialNumber: payload.serialNumber ? String(payload.serialNumber).trim().toUpperCase() : null,
    macAddress: payload.macAddress ? String(payload.macAddress).trim() : null,
    site: payload.site ? String(payload.site).trim() : null,
    location: payload.location ? String(payload.location).trim() : null,
    notes: payload.notes ? String(payload.notes).trim() : null,
    managementIp: payload.managementIp ? String(payload.managementIp).trim() : null,
    purchaseDate: payload.purchaseDate ? new Date(payload.purchaseDate) : null,
  };
}

function normalizePoolPayload(payload = {}) {
  return {
    name: payload.name ? String(payload.name).trim() : '',
    kind: payload.kind ? String(payload.kind).trim() : 'static',
    status: payload.status ? String(payload.status).trim() : 'active',
    cidr: payload.cidr ? String(payload.cidr).trim() : '',
    gateway: payload.gateway ? String(payload.gateway).trim() : null,
    dnsServers: normalizeDnsServers(payload.dnsServers),
    vlanId:
      payload.vlanId === '' || payload.vlanId === undefined || payload.vlanId === null
        ? null
        : Number(payload.vlanId),
    site: payload.site ? String(payload.site).trim() : null,
    notes: payload.notes ? String(payload.notes).trim() : null,
  };
}

function serializeAsset(asset, extra = {}) {
  const doc = typeof asset.toObject === 'function' ? asset.toObject() : asset;
  return {
    ...doc,
    _id: toId(doc._id),
    assignedCustomer: doc.assignedCustomer
      ? {
          _id: toId(doc.assignedCustomer._id || doc.assignedCustomer),
          name: doc.assignedCustomer.name || null,
          accountNumber: doc.assignedCustomer.accountNumber || null,
          phone: doc.assignedCustomer.phone || null,
          connectionType: doc.assignedCustomer.connectionType || null,
        }
      : null,
    activeAssignmentCount: Number(extra.activeAssignmentCount || 0),
  };
}

function serializePool(pool, usage = null) {
  const doc = typeof pool.toObject === 'function' ? pool.toObject() : pool;
  return {
    ...doc,
    _id: toId(doc._id),
    usage: usage || null,
  };
}

function serializeAssignment(assignment) {
  const doc = typeof assignment.toObject === 'function' ? assignment.toObject() : assignment;
  return {
    ...doc,
    _id: toId(doc._id),
    pool: doc.pool
      ? {
          _id: toId(doc.pool._id || doc.pool),
          name: doc.pool.name || null,
          cidr: doc.pool.cidr || null,
          kind: doc.pool.kind || null,
          gateway: doc.pool.gateway || null,
          site: doc.pool.site || null,
        }
      : null,
    customer: doc.customer
      ? {
          _id: toId(doc.customer._id || doc.customer),
          name: doc.customer.name || null,
          accountNumber: doc.customer.accountNumber || null,
          phone: doc.customer.phone || null,
          connectionType: doc.customer.connectionType || null,
        }
      : null,
    asset: doc.asset
      ? {
          _id: toId(doc.asset._id || doc.asset),
          assetTag: doc.asset.assetTag || null,
          name: doc.asset.name || null,
          kind: doc.asset.kind || null,
          status: doc.asset.status || null,
        }
      : null,
  };
}

async function getServiceOperationsSummary(tenantId) {
  const [assetCounts, pools, activeAssignments] = await Promise.all([
    InventoryAsset.aggregate([
      { $match: { tenantId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    IpPool.find({ tenantId }).lean(),
    IpAssignment.find({ tenantId, releasedAt: null })
      .select({ pool: 1, ipAddress: 1, status: 1 })
      .lean(),
  ]);

  const poolAssignments = activeAssignments.reduce((acc, row) => {
    const key = String(row.pool);
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});

  let totalUsableHosts = 0;
  let totalFreeHosts = 0;
  let totalAllocated = 0;
  let totalReserved = 0;

  pools.forEach((pool) => {
    const usage = poolUsageFromAssignments(
      pool,
      poolAssignments[String(pool._id)] || []
    );
    totalUsableHosts += usage.usableHostCount;
    totalFreeHosts += usage.freeCount;
    totalAllocated += usage.allocatedCount;
    totalReserved += usage.reservedCount + usage.gatewayReserved;
  });

  const statusCounts = assetCounts.reduce((acc, row) => {
    acc[row._id] = row.count;
    return acc;
  }, {});

  return {
    totalAssets: Object.values(statusCounts).reduce((sum, count) => sum + Number(count || 0), 0),
    assignedAssets: Number(statusCounts.assigned || 0),
    spareAssets: Number(statusCounts.spare || 0) + Number(statusCounts.in_stock || 0),
    maintenanceAssets: Number(statusCounts.maintenance || 0),
    faultyAssets: Number(statusCounts.faulty || 0),
    retiredAssets: Number(statusCounts.retired || 0),
    totalPools: pools.length,
    activePools: pools.filter((pool) => pool.status === 'active').length,
    totalUsableHosts,
    allocatedHosts: totalAllocated,
    reservedHosts: totalReserved,
    freeHosts: totalFreeHosts,
    activeAssignments: activeAssignments.length,
  };
}

async function listInventoryAssets(tenantId, options = {}) {
  const limit = Math.min(Number(options.limit) || 200, 500);
  const filter = { tenantId };
  if (options.status) filter.status = String(options.status).trim();
  if (options.kind) filter.kind = String(options.kind).trim();
  if (options.customerId) filter.assignedCustomer = String(options.customerId).trim();
  if (options.query) {
    const regex = new RegExp(String(options.query).trim(), 'i');
    filter.$or = [
      { assetTag: regex },
      { name: regex },
      { vendor: regex },
      { model: regex },
      { serialNumber: regex },
      { macAddress: regex },
      { site: regex },
      { location: regex },
    ];
  }

  const [assets, assignmentCounts] = await Promise.all([
    InventoryAsset.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('assignedCustomer', 'name accountNumber phone connectionType'),
    IpAssignment.aggregate([
      { $match: { tenantId, releasedAt: null, asset: { $ne: null } } },
      { $group: { _id: '$asset', count: { $sum: 1 } } },
    ]),
  ]);

  const assignmentCountMap = assignmentCounts.reduce((acc, row) => {
    acc[String(row._id)] = row.count;
    return acc;
  }, {});

  return assets.map((asset) =>
    serializeAsset(asset, { activeAssignmentCount: assignmentCountMap[String(asset._id)] || 0 })
  );
}

async function createInventoryAsset(tenantId, payload = {}, actor = null) {
  const normalized = normalizeAssetPayload(payload);
  if (!normalized.assetTag) throw serviceError(400, 'assetTag is required');
  if (!normalized.name) throw serviceError(400, 'name is required');

  const asset = await InventoryAsset.create({
    tenantId,
    ...normalized,
  }).catch((err) => {
    if (err?.code === 11000) {
      throw serviceError(409, 'Asset tag, serial number, or MAC address already exists');
    }
    throw err;
  });

  await logAudit(tenantId, actor, 'service-ops.asset.create', {
    assetId: String(asset._id),
    assetTag: asset.assetTag,
    kind: asset.kind,
    status: asset.status,
  });

  return serializeAsset(asset);
}

async function updateInventoryAsset(tenantId, assetId, payload = {}, actor = null) {
  const asset = await InventoryAsset.findOne({ _id: assetId, tenantId });
  if (!asset) throw serviceError(404, 'Asset not found');

  const normalized = normalizeAssetPayload(payload);
  const fields = [
    'assetTag',
    'name',
    'kind',
    'status',
    'vendor',
    'model',
    'serialNumber',
    'macAddress',
    'site',
    'location',
    'notes',
    'managementIp',
    'purchaseDate',
  ];
  fields.forEach((field) => {
    if (payload[field] !== undefined) {
      asset[field] = normalized[field];
    }
  });

  await asset.save().catch((err) => {
    if (err?.code === 11000) {
      throw serviceError(409, 'Asset tag, serial number, or MAC address already exists');
    }
    throw err;
  });

  await logAudit(tenantId, actor, 'service-ops.asset.update', {
    assetId: String(asset._id),
    assetTag: asset.assetTag,
    status: asset.status,
  });

  return serializeAsset(asset);
}

async function assignAssetToCustomer(tenantId, assetId, payload = {}, actor = null) {
  const asset = await InventoryAsset.findOne({ _id: assetId, tenantId });
  if (!asset) throw serviceError(404, 'Asset not found');
  if (!payload.customerId) throw serviceError(400, 'customerId is required');

  const customer = await Customer.findOne({ _id: payload.customerId, tenantId })
    .select({ name: 1, accountNumber: 1, phone: 1, connectionType: 1 });
  if (!customer) throw serviceError(404, 'Customer not found');

  asset.assignedCustomer = customer._id;
  asset.installedAt = payload.installedAt ? new Date(payload.installedAt) : asset.installedAt || new Date();
  if (asset.status === 'in_stock' || asset.status === 'spare') {
    asset.status = 'assigned';
  }
  if (typeof payload.notes === 'string') {
    asset.notes = payload.notes.trim() || asset.notes;
  }
  await asset.save();

  await logAudit(tenantId, actor, 'service-ops.asset.assign-customer', {
    assetId: String(asset._id),
    customerId: String(customer._id),
    installedAt: asset.installedAt,
  });

  await asset.populate('assignedCustomer', 'name accountNumber phone connectionType');
  return serializeAsset(asset);
}

async function unassignAssetFromCustomer(tenantId, assetId, payload = {}, actor = null) {
  const asset = await InventoryAsset.findOne({ _id: assetId, tenantId })
    .populate('assignedCustomer', 'name accountNumber');
  if (!asset) throw serviceError(404, 'Asset not found');

  const previousCustomerId = toId(asset.assignedCustomer);
  asset.assignedCustomer = null;
  asset.installedAt = null;
  if (asset.status === 'assigned') {
    asset.status = 'spare';
  }
  if (typeof payload.notes === 'string') {
    asset.notes = payload.notes.trim() || asset.notes;
  }
  await asset.save();

  await logAudit(tenantId, actor, 'service-ops.asset.unassign-customer', {
    assetId: String(asset._id),
    previousCustomerId,
  });

  return serializeAsset(asset);
}

async function listIpPools(tenantId, options = {}) {
  const filter = { tenantId };
  if (options.status) filter.status = String(options.status).trim();
  if (options.kind) filter.kind = String(options.kind).trim();
  if (options.site) filter.site = String(options.site).trim();

  const [pools, assignments] = await Promise.all([
    IpPool.find(filter).sort({ createdAt: -1 }),
    IpAssignment.find({ tenantId, releasedAt: null })
      .select({ pool: 1, ipAddress: 1, status: 1 })
      .lean(),
  ]);

  const byPool = assignments.reduce((acc, row) => {
    const key = String(row.pool);
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});

  return pools.map((pool) => {
    const usage = poolUsageFromAssignments(pool, byPool[String(pool._id)] || []);
    return serializePool(pool, usage);
  });
}

async function createIpPool(tenantId, payload = {}, actor = null) {
  const normalized = normalizePoolPayload(payload);
  if (!normalized.name) throw serviceError(400, 'name is required');
  if (!normalized.cidr) throw serviceError(400, 'cidr is required');
  parseCidr(normalized.cidr);

  const pool = await IpPool.create({
    tenantId,
    ...normalized,
  }).catch((err) => {
    if (err?.code === 11000) {
      throw serviceError(409, 'Pool name or CIDR already exists');
    }
    throw err;
  });

  await logAudit(tenantId, actor, 'service-ops.ip-pool.create', {
    poolId: String(pool._id),
    name: pool.name,
    cidr: pool.cidr,
    kind: pool.kind,
  });

  return serializePool(pool, poolUsageFromAssignments(pool, []));
}

async function updateIpPool(tenantId, poolId, payload = {}, actor = null) {
  const pool = await IpPool.findOne({ _id: poolId, tenantId });
  if (!pool) throw serviceError(404, 'IP pool not found');

  const normalized = normalizePoolPayload(payload);
  const activeAssignments = await IpAssignment.find({
    tenantId,
    pool: pool._id,
    releasedAt: null,
  })
    .select({ ipAddress: 1, status: 1 })
    .lean();

  if (payload.cidr !== undefined) {
    const nextRange = parseCidr(normalized.cidr);
    const outside = activeAssignments.find((row) => !nextRange.contains(row.ipAddress));
    if (outside) {
      throw serviceError(409, `Existing assignment ${outside.ipAddress} falls outside the updated CIDR`);
    }
    pool.cidr = normalized.cidr;
  }
  if (payload.name !== undefined) pool.name = normalized.name;
  if (payload.kind !== undefined) pool.kind = normalized.kind;
  if (payload.status !== undefined) pool.status = normalized.status;
  if (payload.gateway !== undefined) pool.gateway = normalized.gateway;
  if (payload.dnsServers !== undefined) pool.dnsServers = normalized.dnsServers;
  if (payload.vlanId !== undefined) pool.vlanId = normalized.vlanId;
  if (payload.site !== undefined) pool.site = normalized.site;
  if (payload.notes !== undefined) pool.notes = normalized.notes;

  await pool.save().catch((err) => {
    if (err?.code === 11000) {
      throw serviceError(409, 'Pool name or CIDR already exists');
    }
    throw err;
  });

  await logAudit(tenantId, actor, 'service-ops.ip-pool.update', {
    poolId: String(pool._id),
    name: pool.name,
    cidr: pool.cidr,
    status: pool.status,
  });

  const usage = poolUsageFromAssignments(pool, activeAssignments);
  return serializePool(pool, usage);
}

async function listIpAssignments(tenantId, options = {}) {
  const limit = Math.min(Number(options.limit) || 200, 500);
  const filter = { tenantId };
  if (options.poolId) filter.pool = String(options.poolId).trim();
  if (options.customerId) filter.customer = String(options.customerId).trim();
  if (options.assetId) filter.asset = String(options.assetId).trim();
  if (options.status) filter.status = String(options.status).trim();
  if (options.purpose) filter.purpose = String(options.purpose).trim();

  const assignments = await IpAssignment.find(filter)
    .sort({ releasedAt: 1, allocatedAt: -1, createdAt: -1 })
    .limit(limit)
    .populate('pool', 'name cidr kind gateway site')
    .populate('customer', 'name accountNumber phone connectionType')
    .populate('asset', 'assetTag name kind status');

  return assignments.map(serializeAssignment);
}

async function syncCustomerWanAssignment({ customerId, ipAddress, pool, release = false }) {
  if (!customerId) return;
  const customer = await Customer.findById(customerId);
  if (!customer || customer.connectionType !== 'static') return;

  if (release) {
    if (String(customer.staticConfig?.ip || '').trim() === ipAddress) {
      customer.staticConfig = {
        ...(customer.staticConfig || {}),
        ip: null,
      };
      await customer.save();
    }
    return;
  }

  customer.staticConfig = {
    ...(customer.staticConfig || {}),
    ip: ipAddress,
    gateway: pool.gateway || customer.staticConfig?.gateway || null,
    dns: Array.isArray(pool.dnsServers) && pool.dnsServers.length
      ? pool.dnsServers.join(', ')
      : customer.staticConfig?.dns || null,
  };
  await customer.save();
}

async function syncAssetManagementIp({ assetId, ipAddress, release = false }) {
  if (!assetId) return;
  const asset = await InventoryAsset.findById(assetId);
  if (!asset) return;
  if (release) {
    if (String(asset.managementIp || '').trim() === ipAddress) {
      asset.managementIp = null;
      await asset.save();
    }
    return;
  }
  asset.managementIp = ipAddress;
  await asset.save();
}

async function allocateIpAddress(tenantId, poolId, payload = {}, actor = null) {
  const pool = await IpPool.findOne({ _id: poolId, tenantId });
  if (!pool) throw serviceError(404, 'IP pool not found');
  if (pool.status !== 'active') throw serviceError(409, 'IP pool is disabled');

  const purpose = payload.purpose ? String(payload.purpose).trim() : 'customer-wan';
  const preferredIp = payload.ipAddress ? normalizeIPv4(payload.ipAddress) : null;
  const note = typeof payload.note === 'string' ? payload.note.trim() || null : null;

  if (purpose === 'customer-wan' && !payload.customerId) {
    throw serviceError(400, 'customerId is required for customer-wan allocations');
  }
  if (purpose === 'device-management' && !payload.assetId) {
    throw serviceError(400, 'assetId is required for device-management allocations');
  }

  let customer = null;
  let asset = null;
  if (payload.customerId) {
    customer = await Customer.findOne({ _id: payload.customerId, tenantId })
      .select({ name: 1, accountNumber: 1, phone: 1, connectionType: 1 });
    if (!customer) throw serviceError(404, 'Customer not found');
  }
  if (payload.assetId) {
    asset = await InventoryAsset.findOne({ _id: payload.assetId, tenantId })
      .select({ assetTag: 1, name: 1, kind: 1, status: 1, managementIp: 1 });
    if (!asset) throw serviceError(404, 'Asset not found');
  }

  const activeAssignments = await IpAssignment.find({
    tenantId,
    pool: pool._id,
    releasedAt: null,
  })
    .select({ ipAddress: 1, status: 1 })
    .lean();

  const usedIps = activeAssignments.map((row) => row.ipAddress);
  const excludedIps = pool.gateway ? [pool.gateway] : [];
  const allowedIpList = Array.isArray(pool.addressList) ? pool.addressList : [];

  let ipAddress = preferredIp;
  if (ipAddress) {
    if (pool.allocationStrategy === 'list') {
      if (!allowedIpList.includes(ipAddress)) {
        throw serviceError(400, 'Requested IP must be present in the pool address list');
      }
    } else {
      const parsed = parseCidr(pool.cidr);
      if (!parsed.isUsableHost(ipAddress)) {
        throw serviceError(400, 'Requested IP must be a usable host inside the pool');
      }
    }
    if (excludedIps.includes(ipAddress)) {
      throw serviceError(409, 'Requested IP is reserved as the pool gateway');
    }
    if (usedIps.includes(ipAddress)) {
      throw serviceError(409, 'Requested IP is already allocated');
    }
  } else {
    ipAddress = pickNextAvailableIp({
      cidr: pool,
      usedIps,
      excludedIps,
    });
    if (!ipAddress) {
      throw serviceError(409, 'No available IP address remains in this pool');
    }
  }

  const assignment = await IpAssignment.create({
    tenantId,
    pool: pool._id,
    ipAddress,
    status: purpose === 'reserved' ? 'reserved' : 'allocated',
    purpose,
    customer: customer?._id || null,
    asset: asset?._id || null,
    note,
    allocatedAt: payload.allocatedAt ? new Date(payload.allocatedAt) : new Date(),
  }).catch((err) => {
    if (err?.code === 11000) {
      throw serviceError(409, 'That IP address is already allocated');
    }
    throw err;
  });

  if (purpose === 'customer-wan' && customer?._id) {
    await syncCustomerWanAssignment({ customerId: customer._id, ipAddress, pool });
  }
  if (purpose === 'device-management' && asset?._id) {
    await syncAssetManagementIp({ assetId: asset._id, ipAddress });
  }

  await logAudit(tenantId, actor, 'service-ops.ip-assignment.allocate', {
    assignmentId: String(assignment._id),
    poolId: String(pool._id),
    ipAddress,
    purpose,
    customerId: customer ? String(customer._id) : null,
    assetId: asset ? String(asset._id) : null,
  });

  await assignment.populate('pool', 'name cidr kind gateway site');
  if (customer) await assignment.populate('customer', 'name accountNumber phone connectionType');
  if (asset) await assignment.populate('asset', 'assetTag name kind status');
  return serializeAssignment(assignment);
}

async function releaseIpAssignment(tenantId, assignmentId, payload = {}, actor = null) {
  const assignment = await IpAssignment.findOne({
    _id: assignmentId,
    tenantId,
    releasedAt: null,
  })
    .populate('pool', 'name cidr kind gateway site')
    .populate('customer', 'name accountNumber phone connectionType')
    .populate('asset', 'assetTag name kind status');
  if (!assignment) throw serviceError(404, 'Active IP assignment not found');

  assignment.status = 'released';
  assignment.releasedAt = new Date();
  assignment.releasedReason =
    typeof payload.reason === 'string' ? payload.reason.trim() || 'Released by operator' : 'Released by operator';
  await assignment.save();

  if (assignment.purpose === 'customer-wan' && assignment.customer?._id) {
    await syncCustomerWanAssignment({
      customerId: assignment.customer._id,
      ipAddress: assignment.ipAddress,
      pool: assignment.pool,
      release: true,
    });
  }
  if (assignment.purpose === 'device-management' && assignment.asset?._id) {
    await syncAssetManagementIp({
      assetId: assignment.asset._id,
      ipAddress: assignment.ipAddress,
      release: true,
    });
  }

  await logAudit(tenantId, actor, 'service-ops.ip-assignment.release', {
    assignmentId: String(assignment._id),
    poolId: toId(assignment.pool),
    ipAddress: assignment.ipAddress,
    reason: assignment.releasedReason,
  });

  return serializeAssignment(assignment);
}

module.exports = {
  getServiceOperationsSummary,
  listInventoryAssets,
  createInventoryAsset,
  updateInventoryAsset,
  assignAssetToCustomer,
  unassignAssetFromCustomer,
  listIpPools,
  createIpPool,
  updateIpPool,
  listIpAssignments,
  allocateIpAddress,
  releaseIpAssignment,
};
