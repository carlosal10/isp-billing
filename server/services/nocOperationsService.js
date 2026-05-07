'use strict';

const AuditLog = require('../models/AuditLog');
const Customer = require('../models/customers');
const InventoryAsset = require('../models/InventoryAsset');
const NocIncident = require('../models/NocIncident');
const {
  isActiveIncidentStatus,
  normalizeIncidentKind,
  normalizeIncidentSeverity,
  normalizeIncidentStatus,
} = require('./nocMath');

function serviceError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
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

function nextSequenceId(prefix) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${stamp}-${random}`;
}

function toId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}

function serializeIncident(incident) {
  const doc = typeof incident.toObject === 'function' ? incident.toObject() : incident;
  return {
    ...doc,
    _id: toId(doc._id),
    affectedCustomerCount: Array.isArray(doc.affectedCustomers) ? doc.affectedCustomers.length : 0,
    affectedAssetCount: Array.isArray(doc.affectedAssets) ? doc.affectedAssets.length : 0,
    affectedCustomers: Array.isArray(doc.affectedCustomers)
      ? doc.affectedCustomers.map((customer) => ({
          _id: toId(customer._id || customer),
          name: customer.name || null,
          accountNumber: customer.accountNumber || null,
          phone: customer.phone || null,
        }))
      : [],
    affectedAssets: Array.isArray(doc.affectedAssets)
      ? doc.affectedAssets.map((asset) => ({
          _id: toId(asset._id || asset),
          assetTag: asset.assetTag || null,
          name: asset.name || null,
          kind: asset.kind || null,
          site: asset.site || null,
        }))
      : [],
  };
}

async function requireCustomers(tenantId, customerIds = []) {
  const ids = Array.isArray(customerIds)
    ? Array.from(new Set(customerIds.map((value) => String(value || '').trim()).filter(Boolean)))
    : [];
  if (!ids.length) return [];
  const customers = await Customer.find({ _id: { $in: ids }, tenantId })
    .select({ name: 1, accountNumber: 1, phone: 1 });
  if (customers.length !== ids.length) throw serviceError(404, 'One or more customers were not found');
  const rank = new Map(customers.map((customer) => [String(customer._id), customer]));
  return ids.map((id) => rank.get(id));
}

async function requireAssets(tenantId, assetIds = []) {
  const ids = Array.isArray(assetIds)
    ? Array.from(new Set(assetIds.map((value) => String(value || '').trim()).filter(Boolean)))
    : [];
  if (!ids.length) return [];
  const assets = await InventoryAsset.find({ _id: { $in: ids }, tenantId })
    .select({ assetTag: 1, name: 1, kind: 1, site: 1 });
  if (assets.length !== ids.length) throw serviceError(404, 'One or more assets were not found');
  const rank = new Map(assets.map((asset) => [String(asset._id), asset]));
  return ids.map((id) => rank.get(id));
}

async function listIncidents(tenantId, options = {}) {
  const limit = Math.min(Number(options.limit) || 200, 500);
  const filter = { tenantId };
  if (options.status) filter.status = normalizeIncidentStatus(options.kind, options.status);
  if (options.severity) filter.severity = normalizeIncidentSeverity(options.severity);
  if (options.kind) filter.kind = normalizeIncidentKind(options.kind);
  if (options.query) {
    const regex = new RegExp(String(options.query).trim(), 'i');
    filter.$or = [
      { incidentNumber: regex },
      { title: regex },
      { summary: regex },
      { site: regex },
      { routerName: regex },
    ];
  }

  const incidents = await NocIncident.find(filter)
    .sort({ startedAt: -1, createdAt: -1 })
    .limit(limit)
    .populate('affectedCustomers', 'name accountNumber phone')
    .populate('affectedAssets', 'assetTag name kind site');

  return incidents.map(serializeIncident);
}

async function createIncident(tenantId, payload = {}, actor = null) {
  const title = String(payload.title || '').trim();
  if (!title) throw serviceError(400, 'title is required');

  const customers = await requireCustomers(tenantId, payload.affectedCustomerIds);
  const assets = await requireAssets(tenantId, payload.affectedAssetIds);
  const kind = normalizeIncidentKind(payload.kind);
  const status = normalizeIncidentStatus(kind, payload.status);

  const incident = await NocIncident.create({
    tenantId,
    incidentNumber: nextSequenceId('INC'),
    title,
    summary: typeof payload.summary === 'string' ? payload.summary.trim() || null : null,
    kind,
    severity: normalizeIncidentSeverity(payload.severity),
    status,
    site: typeof payload.site === 'string' ? payload.site.trim() || null : null,
    routerName: typeof payload.routerName === 'string' ? payload.routerName.trim() || null : null,
    detectedAt: payload.detectedAt ? new Date(payload.detectedAt) : new Date(),
    startedAt: payload.startedAt ? new Date(payload.startedAt) : new Date(),
    plannedStart: payload.plannedStart ? new Date(payload.plannedStart) : null,
    plannedEnd: payload.plannedEnd ? new Date(payload.plannedEnd) : null,
    affectedCustomers: customers.map((customer) => customer._id),
    affectedAssets: assets.map((asset) => asset._id),
    updates: typeof payload.update === 'string' && payload.update.trim()
      ? [{ author: requestActor(actor), body: payload.update.trim() }]
      : [],
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    notificationState: typeof payload.notificationState === 'string'
      ? payload.notificationState.trim() || 'not_started'
      : 'not_started',
  });

  await incident.populate('affectedCustomers', 'name accountNumber phone');
  await incident.populate('affectedAssets', 'assetTag name kind site');

  await logAudit(tenantId, actor, 'noc.incident.create', {
    incidentId: String(incident._id),
    incidentNumber: incident.incidentNumber,
    kind: incident.kind,
    status: incident.status,
    severity: incident.severity,
  });

  return serializeIncident(incident);
}

async function updateIncident(tenantId, incidentId, payload = {}, actor = null) {
  const incident = await NocIncident.findOne({ _id: incidentId, tenantId });
  if (!incident) throw serviceError(404, 'Incident not found');

  if (payload.title !== undefined) incident.title = String(payload.title || '').trim();
  if (payload.summary !== undefined) incident.summary = String(payload.summary || '').trim() || null;
  if (payload.kind !== undefined) incident.kind = normalizeIncidentKind(payload.kind);
  if (payload.severity !== undefined) incident.severity = normalizeIncidentSeverity(payload.severity);
  if (payload.status !== undefined || payload.kind !== undefined) {
    incident.status = normalizeIncidentStatus(incident.kind, payload.status ?? incident.status);
  }
  if (payload.site !== undefined) incident.site = String(payload.site || '').trim() || null;
  if (payload.routerName !== undefined) incident.routerName = String(payload.routerName || '').trim() || null;
  if (payload.detectedAt !== undefined) incident.detectedAt = payload.detectedAt ? new Date(payload.detectedAt) : null;
  if (payload.startedAt !== undefined) incident.startedAt = payload.startedAt ? new Date(payload.startedAt) : null;
  if (payload.plannedStart !== undefined) incident.plannedStart = payload.plannedStart ? new Date(payload.plannedStart) : null;
  if (payload.plannedEnd !== undefined) incident.plannedEnd = payload.plannedEnd ? new Date(payload.plannedEnd) : null;
  if (payload.notificationState !== undefined) {
    incident.notificationState = String(payload.notificationState || '').trim() || 'not_started';
  }
  if (Array.isArray(payload.tags)) incident.tags = payload.tags;
  if (payload.affectedCustomerIds !== undefined) {
    const customers = await requireCustomers(tenantId, payload.affectedCustomerIds);
    incident.affectedCustomers = customers.map((customer) => customer._id);
  }
  if (payload.affectedAssetIds !== undefined) {
    const assets = await requireAssets(tenantId, payload.affectedAssetIds);
    incident.affectedAssets = assets.map((asset) => asset._id);
  }
  if (typeof payload.update === 'string' && payload.update.trim()) {
    incident.updates.push({
      author: requestActor(actor),
      body: payload.update.trim(),
    });
  }

  await incident.save();
  await incident.populate('affectedCustomers', 'name accountNumber phone');
  await incident.populate('affectedAssets', 'assetTag name kind site');

  await logAudit(tenantId, actor, 'noc.incident.update', {
    incidentId: String(incident._id),
    incidentNumber: incident.incidentNumber,
    kind: incident.kind,
    status: incident.status,
    severity: incident.severity,
  });

  return serializeIncident(incident);
}

async function getNocSummary(tenantId) {
  const [statusCounts, criticalIncidents, maintenanceScheduled, recentResolved] = await Promise.all([
    NocIncident.aggregate([
      { $match: { tenantId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    NocIncident.countDocuments({
      tenantId,
      severity: 'critical',
      status: { $in: ['open', 'investigating', 'monitoring'] },
    }),
    NocIncident.countDocuments({
      tenantId,
      kind: 'maintenance',
      status: 'scheduled',
    }),
    NocIncident.countDocuments({
      tenantId,
      status: 'resolved',
      resolvedAt: {
        $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      },
    }),
  ]);

  const statusMap = statusCounts.reduce((acc, row) => {
    acc[row._id] = row.count;
    return acc;
  }, {});

  return {
    activeIncidents: Number(
      Object.entries(statusMap)
        .filter(([status]) => isActiveIncidentStatus(status))
        .reduce((sum, [, count]) => sum + count, 0)
    ),
    investigatingIncidents: Number(statusMap.investigating || 0),
    monitoringIncidents: Number(statusMap.monitoring || 0),
    criticalIncidents: Number(criticalIncidents || 0),
    scheduledMaintenance: Number(maintenanceScheduled || 0),
    resolvedThisWeek: Number(recentResolved || 0),
  };
}

module.exports = {
  createIncident,
  getNocSummary,
  listIncidents,
  updateIncident,
};
