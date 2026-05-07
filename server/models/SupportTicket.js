'use strict';

const mongoose = require('mongoose');

const TICKET_STATUS = ['open', 'in_progress', 'waiting', 'resolved', 'closed'];
const TICKET_PRIORITY = ['low', 'medium', 'high', 'urgent'];
const TICKET_CHANNEL = ['phone', 'email', 'walk-in', 'portal', 'internal'];

const ticketNoteSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    author: { type: String, trim: true, default: null },
    body: { type: String, trim: true, required: true },
  },
  { _id: false }
);

const supportTicketSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    ticketNumber: { type: String, trim: true, required: true, index: true },
    title: { type: String, trim: true, required: true },
    description: { type: String, trim: true, default: null },
    status: { type: String, enum: TICKET_STATUS, default: 'open', index: true },
    priority: { type: String, enum: TICKET_PRIORITY, default: 'medium', index: true },
    channel: { type: String, enum: TICKET_CHANNEL, default: 'internal' },
    category: { type: String, trim: true, default: null },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    asset: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryAsset', default: null, index: true },
    workOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkOrder', default: null, index: true },
    assigneeName: { type: String, trim: true, default: null },
    assigneeEmail: { type: String, trim: true, default: null },
    openedAt: { type: Date, default: Date.now, index: true },
    firstResponseDueAt: { type: Date, default: null, index: true },
    resolutionDueAt: { type: Date, default: null, index: true },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    lastStatusAt: { type: Date, default: Date.now },
    notes: { type: [ticketNoteSchema], default: [] },
    tags: { type: [String], default: [] },
    metadata: { type: Object, default: {} },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

supportTicketSchema.pre('validate', function normalizeSupportTicket() {
  if (this.ticketNumber) this.ticketNumber = String(this.ticketNumber).trim().toUpperCase();
  if (this.title) this.title = String(this.title).trim();
  if (this.description) this.description = String(this.description).trim();
  if (this.category) this.category = String(this.category).trim();
  if (this.assigneeName) this.assigneeName = String(this.assigneeName).trim();
  if (this.assigneeEmail) this.assigneeEmail = String(this.assigneeEmail).trim().toLowerCase();
  this.tags = Array.isArray(this.tags)
    ? Array.from(new Set(this.tags.map((tag) => String(tag || '').trim()).filter(Boolean)))
    : [];

  if (this.status === 'resolved' && !this.resolvedAt) {
    this.resolvedAt = new Date();
  }
  if (this.status === 'closed' && !this.closedAt) {
    this.closedAt = new Date();
  }
  if (this.status !== 'resolved') {
    this.resolvedAt = null;
  }
  if (this.status !== 'closed') {
    this.closedAt = null;
  }
  this.lastStatusAt = new Date();
});

supportTicketSchema.index({ tenantId: 1, ticketNumber: 1 }, { unique: true });
supportTicketSchema.index({ tenantId: 1, status: 1, priority: 1, openedAt: -1 });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
