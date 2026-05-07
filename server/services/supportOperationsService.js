'use strict';

const AuditLog = require('../models/AuditLog');
const Customer = require('../models/customers');
const InventoryAsset = require('../models/InventoryAsset');
const SupportTicket = require('../models/SupportTicket');
const WorkOrder = require('../models/WorkOrder');
const { computeTicketSla, normalizePriority } = require('./supportSlaMath');

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

function serializeTicket(ticket) {
  const doc = typeof ticket.toObject === 'function' ? ticket.toObject() : ticket;
  return {
    ...doc,
    _id: toId(doc._id),
    customer: doc.customer
      ? {
          _id: toId(doc.customer._id || doc.customer),
          name: doc.customer.name || null,
          accountNumber: doc.customer.accountNumber || null,
          phone: doc.customer.phone || null,
        }
      : null,
    asset: doc.asset
      ? {
          _id: toId(doc.asset._id || doc.asset),
          assetTag: doc.asset.assetTag || null,
          name: doc.asset.name || null,
          kind: doc.asset.kind || null,
        }
      : null,
    workOrder: doc.workOrder
      ? {
          _id: toId(doc.workOrder._id || doc.workOrder),
          orderNumber: doc.workOrder.orderNumber || null,
          status: doc.workOrder.status || null,
          type: doc.workOrder.type || null,
        }
      : null,
  };
}

function serializeWorkOrder(order) {
  const doc = typeof order.toObject === 'function' ? order.toObject() : order;
  return {
    ...doc,
    _id: toId(doc._id),
    customer: doc.customer
      ? {
          _id: toId(doc.customer._id || doc.customer),
          name: doc.customer.name || null,
          accountNumber: doc.customer.accountNumber || null,
          phone: doc.customer.phone || null,
        }
      : null,
    asset: doc.asset
      ? {
          _id: toId(doc.asset._id || doc.asset),
          assetTag: doc.asset.assetTag || null,
          name: doc.asset.name || null,
          kind: doc.asset.kind || null,
        }
      : null,
    ticket: doc.ticket
      ? {
          _id: toId(doc.ticket._id || doc.ticket),
          ticketNumber: doc.ticket.ticketNumber || null,
          status: doc.ticket.status || null,
          priority: doc.ticket.priority || null,
        }
      : null,
  };
}

async function requireCustomerIfPresent(tenantId, customerId) {
  if (!customerId) return null;
  const customer = await Customer.findOne({ _id: customerId, tenantId })
    .select({ name: 1, accountNumber: 1, phone: 1 });
  if (!customer) throw serviceError(404, 'Customer not found');
  return customer;
}

async function requireAssetIfPresent(tenantId, assetId) {
  if (!assetId) return null;
  const asset = await InventoryAsset.findOne({ _id: assetId, tenantId })
    .select({ assetTag: 1, name: 1, kind: 1 });
  if (!asset) throw serviceError(404, 'Asset not found');
  return asset;
}

async function requireTicketIfPresent(tenantId, ticketId) {
  if (!ticketId) return null;
  const ticket = await SupportTicket.findOne({ _id: ticketId, tenantId })
    .select({ ticketNumber: 1, status: 1, priority: 1 });
  if (!ticket) throw serviceError(404, 'Ticket not found');
  return ticket;
}

async function listSupportTickets(tenantId, options = {}) {
  const limit = Math.min(Number(options.limit) || 200, 500);
  const filter = { tenantId };
  if (options.status) filter.status = String(options.status).trim();
  if (options.priority) filter.priority = String(options.priority).trim();
  if (options.customerId) filter.customer = String(options.customerId).trim();
  if (options.assetId) filter.asset = String(options.assetId).trim();
  if (options.query) {
    const regex = new RegExp(String(options.query).trim(), 'i');
    filter.$or = [
      { ticketNumber: regex },
      { title: regex },
      { description: regex },
      { assigneeName: regex },
      { assigneeEmail: regex },
    ];
  }

  const tickets = await SupportTicket.find(filter)
    .sort({ openedAt: -1, createdAt: -1 })
    .limit(limit)
    .populate('customer', 'name accountNumber phone')
    .populate('asset', 'assetTag name kind')
    .populate('workOrder', 'orderNumber status type');

  return tickets.map(serializeTicket);
}

async function createSupportTicket(tenantId, payload = {}, actor = null) {
  const title = String(payload.title || '').trim();
  if (!title) throw serviceError(400, 'title is required');

  const customer = await requireCustomerIfPresent(tenantId, payload.customerId);
  const asset = await requireAssetIfPresent(tenantId, payload.assetId);
  const priority = normalizePriority(payload.priority);
  const openedAt = payload.openedAt ? new Date(payload.openedAt) : new Date();
  const sla = computeTicketSla(priority, openedAt);

  const ticket = await SupportTicket.create({
    tenantId,
    ticketNumber: nextSequenceId('TCK'),
    title,
    description: typeof payload.description === 'string' ? payload.description.trim() || null : null,
    status: payload.status ? String(payload.status).trim() : 'open',
    priority,
    channel: payload.channel ? String(payload.channel).trim() : 'internal',
    category: typeof payload.category === 'string' ? payload.category.trim() || null : null,
    customer: customer?._id || null,
    asset: asset?._id || null,
    assigneeName: typeof payload.assigneeName === 'string' ? payload.assigneeName.trim() || null : null,
    assigneeEmail: typeof payload.assigneeEmail === 'string' ? payload.assigneeEmail.trim().toLowerCase() || null : null,
    openedAt,
    firstResponseDueAt: sla.firstResponseDueAt,
    resolutionDueAt: sla.resolutionDueAt,
    notes: Array.isArray(payload.notes)
      ? payload.notes
          .map((note) => ({
            author: note?.author ? String(note.author).trim() : requestActor(actor),
            body: note?.body ? String(note.body).trim() : '',
          }))
          .filter((note) => note.body)
      : [],
    tags: Array.isArray(payload.tags) ? payload.tags : [],
  });

  await ticket.populate('customer', 'name accountNumber phone');
  await ticket.populate('asset', 'assetTag name kind');

  await logAudit(tenantId, actor, 'support.ticket.create', {
    ticketId: String(ticket._id),
    ticketNumber: ticket.ticketNumber,
    priority: ticket.priority,
    status: ticket.status,
  });

  return serializeTicket(ticket);
}

async function updateSupportTicket(tenantId, ticketId, payload = {}, actor = null) {
  const ticket = await SupportTicket.findOne({ _id: ticketId, tenantId });
  if (!ticket) throw serviceError(404, 'Ticket not found');

  if (payload.customerId !== undefined) {
    const customer = await requireCustomerIfPresent(tenantId, payload.customerId);
    ticket.customer = customer?._id || null;
  }
  if (payload.assetId !== undefined) {
    const asset = await requireAssetIfPresent(tenantId, payload.assetId);
    ticket.asset = asset?._id || null;
  }
  if (payload.workOrderId !== undefined) {
    const workOrder = payload.workOrderId
      ? await WorkOrder.findOne({ _id: payload.workOrderId, tenantId }).select({ _id: 1, orderNumber: 1, status: 1, type: 1 })
      : null;
    if (payload.workOrderId && !workOrder) throw serviceError(404, 'Work order not found');
    ticket.workOrder = workOrder?._id || null;
  }
  if (payload.title !== undefined) ticket.title = String(payload.title || '').trim();
  if (payload.description !== undefined) ticket.description = String(payload.description || '').trim() || null;
  if (payload.status !== undefined) ticket.status = String(payload.status || '').trim();
  if (payload.priority !== undefined) {
    ticket.priority = normalizePriority(payload.priority);
    const sla = computeTicketSla(ticket.priority, ticket.openedAt || ticket.createdAt || new Date());
    ticket.firstResponseDueAt = sla.firstResponseDueAt;
    ticket.resolutionDueAt = sla.resolutionDueAt;
  }
  if (payload.channel !== undefined) ticket.channel = String(payload.channel || '').trim();
  if (payload.category !== undefined) ticket.category = String(payload.category || '').trim() || null;
  if (payload.assigneeName !== undefined) ticket.assigneeName = String(payload.assigneeName || '').trim() || null;
  if (payload.assigneeEmail !== undefined) ticket.assigneeEmail = String(payload.assigneeEmail || '').trim().toLowerCase() || null;
  if (Array.isArray(payload.tags)) ticket.tags = payload.tags;
  if (typeof payload.note === 'string' && payload.note.trim()) {
    ticket.notes.push({
      author: requestActor(actor),
      body: payload.note.trim(),
    });
  }

  await ticket.save();
  await ticket.populate('customer', 'name accountNumber phone');
  await ticket.populate('asset', 'assetTag name kind');
  await ticket.populate('workOrder', 'orderNumber status type');

  await logAudit(tenantId, actor, 'support.ticket.update', {
    ticketId: String(ticket._id),
    ticketNumber: ticket.ticketNumber,
    status: ticket.status,
    priority: ticket.priority,
  });

  return serializeTicket(ticket);
}

async function listWorkOrders(tenantId, options = {}) {
  const limit = Math.min(Number(options.limit) || 200, 500);
  const filter = { tenantId };
  if (options.status) filter.status = String(options.status).trim();
  if (options.priority) filter.priority = String(options.priority).trim();
  if (options.type) filter.type = String(options.type).trim();
  if (options.customerId) filter.customer = String(options.customerId).trim();
  if (options.assetId) filter.asset = String(options.assetId).trim();
  if (options.ticketId) filter.ticket = String(options.ticketId).trim();
  if (options.query) {
    const regex = new RegExp(String(options.query).trim(), 'i');
    filter.$or = [
      { orderNumber: regex },
      { summary: regex },
      { technicianName: regex },
      { technicianPhone: regex },
      { site: regex },
    ];
  }

  const orders = await WorkOrder.find(filter)
    .sort({ scheduledFor: 1, createdAt: -1 })
    .limit(limit)
    .populate('customer', 'name accountNumber phone')
    .populate('asset', 'assetTag name kind')
    .populate('ticket', 'ticketNumber status priority');

  return orders.map(serializeWorkOrder);
}

async function createWorkOrder(tenantId, payload = {}, actor = null) {
  const summary = String(payload.summary || '').trim();
  if (!summary) throw serviceError(400, 'summary is required');

  const customer = await requireCustomerIfPresent(tenantId, payload.customerId);
  const asset = await requireAssetIfPresent(tenantId, payload.assetId);
  const ticket = await requireTicketIfPresent(tenantId, payload.ticketId);

  const order = await WorkOrder.create({
    tenantId,
    orderNumber: nextSequenceId('WO'),
    type: payload.type ? String(payload.type).trim() : 'repair',
    status: payload.status ? String(payload.status).trim() : 'open',
    priority: normalizePriority(payload.priority),
    customer: customer?._id || null,
    asset: asset?._id || null,
    ticket: ticket?._id || null,
    summary,
    technicianName: typeof payload.technicianName === 'string' ? payload.technicianName.trim() || null : null,
    technicianPhone: typeof payload.technicianPhone === 'string' ? payload.technicianPhone.trim() || null : null,
    site: typeof payload.site === 'string' ? payload.site.trim() || null : null,
    scheduledFor: payload.scheduledFor ? new Date(payload.scheduledFor) : null,
    resolutionNotes: typeof payload.resolutionNotes === 'string' ? payload.resolutionNotes.trim() || null : null,
  });

  if (ticket?._id) {
    await SupportTicket.updateOne(
      { _id: ticket._id, tenantId },
      {
        $set: {
          workOrder: order._id,
          status: ticket.status === 'open' ? 'in_progress' : ticket.status,
        },
      }
    );
  }

  await order.populate('customer', 'name accountNumber phone');
  await order.populate('asset', 'assetTag name kind');
  await order.populate('ticket', 'ticketNumber status priority');

  await logAudit(tenantId, actor, 'support.work-order.create', {
    workOrderId: String(order._id),
    orderNumber: order.orderNumber,
    status: order.status,
    type: order.type,
  });

  return serializeWorkOrder(order);
}

async function updateWorkOrder(tenantId, orderId, payload = {}, actor = null) {
  const order = await WorkOrder.findOne({ _id: orderId, tenantId });
  if (!order) throw serviceError(404, 'Work order not found');

  if (payload.customerId !== undefined) {
    const customer = await requireCustomerIfPresent(tenantId, payload.customerId);
    order.customer = customer?._id || null;
  }
  if (payload.assetId !== undefined) {
    const asset = await requireAssetIfPresent(tenantId, payload.assetId);
    order.asset = asset?._id || null;
  }
  if (payload.ticketId !== undefined) {
    const ticket = await requireTicketIfPresent(tenantId, payload.ticketId);
    order.ticket = ticket?._id || null;
  }
  if (payload.summary !== undefined) order.summary = String(payload.summary || '').trim();
  if (payload.type !== undefined) order.type = String(payload.type || '').trim();
  if (payload.status !== undefined) order.status = String(payload.status || '').trim();
  if (payload.priority !== undefined) order.priority = normalizePriority(payload.priority);
  if (payload.technicianName !== undefined) order.technicianName = String(payload.technicianName || '').trim() || null;
  if (payload.technicianPhone !== undefined) order.technicianPhone = String(payload.technicianPhone || '').trim() || null;
  if (payload.site !== undefined) order.site = String(payload.site || '').trim() || null;
  if (payload.scheduledFor !== undefined) order.scheduledFor = payload.scheduledFor ? new Date(payload.scheduledFor) : null;
  if (payload.resolutionNotes !== undefined) order.resolutionNotes = String(payload.resolutionNotes || '').trim() || null;

  await order.save();
  await order.populate('customer', 'name accountNumber phone');
  await order.populate('asset', 'assetTag name kind');
  await order.populate('ticket', 'ticketNumber status priority');

  if (order.ticket?._id) {
    const nextTicketStatus =
      order.status === 'completed'
        ? 'resolved'
        : ['dispatched', 'in_progress', 'scheduled'].includes(order.status)
          ? 'in_progress'
          : order.status === 'cancelled'
            ? 'waiting'
            : undefined;

    if (nextTicketStatus) {
      await SupportTicket.updateOne(
        { _id: order.ticket._id, tenantId },
        { $set: { status: nextTicketStatus, workOrder: order._id } }
      );
    }
  }

  await logAudit(tenantId, actor, 'support.work-order.update', {
    workOrderId: String(order._id),
    orderNumber: order.orderNumber,
    status: order.status,
    type: order.type,
  });

  return serializeWorkOrder(order);
}

async function getSupportSummary(tenantId) {
  const [ticketCounts, workOrderCounts, overdueTickets] = await Promise.all([
    SupportTicket.aggregate([
      { $match: { tenantId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    WorkOrder.aggregate([
      { $match: { tenantId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    SupportTicket.countDocuments({
      tenantId,
      status: { $in: ['open', 'in_progress', 'waiting'] },
      resolutionDueAt: { $lt: new Date() },
    }),
  ]);

  const ticketMap = ticketCounts.reduce((acc, row) => {
    acc[row._id] = row.count;
    return acc;
  }, {});
  const workOrderMap = workOrderCounts.reduce((acc, row) => {
    acc[row._id] = row.count;
    return acc;
  }, {});

  return {
    openTickets: Number(ticketMap.open || 0),
    inProgressTickets: Number(ticketMap.in_progress || 0),
    waitingTickets: Number(ticketMap.waiting || 0),
    resolvedTickets: Number(ticketMap.resolved || 0),
    overdueTickets: Number(overdueTickets || 0),
    openWorkOrders: Number(workOrderMap.open || 0),
    scheduledWorkOrders: Number(workOrderMap.scheduled || 0),
    dispatchedWorkOrders: Number(workOrderMap.dispatched || 0),
    activeWorkOrders: Number(workOrderMap.in_progress || 0),
    completedWorkOrders: Number(workOrderMap.completed || 0),
  };
}

module.exports = {
  createSupportTicket,
  createWorkOrder,
  getSupportSummary,
  listSupportTickets,
  listWorkOrders,
  updateSupportTicket,
  updateWorkOrder,
};
