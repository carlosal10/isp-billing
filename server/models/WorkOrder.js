'use strict';

const mongoose = require('mongoose');

const WORK_ORDER_TYPE = ['install', 'repair', 'maintenance', 'pickup', 'survey', 'other'];
const WORK_ORDER_STATUS = ['open', 'scheduled', 'dispatched', 'in_progress', 'completed', 'cancelled'];
const WORK_ORDER_PRIORITY = ['low', 'medium', 'high', 'urgent'];

const workOrderSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    orderNumber: { type: String, trim: true, required: true, index: true },
    type: { type: String, enum: WORK_ORDER_TYPE, default: 'repair', index: true },
    status: { type: String, enum: WORK_ORDER_STATUS, default: 'open', index: true },
    priority: { type: String, enum: WORK_ORDER_PRIORITY, default: 'medium', index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    asset: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryAsset', default: null, index: true },
    ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'SupportTicket', default: null, index: true },
    summary: { type: String, trim: true, required: true },
    technicianName: { type: String, trim: true, default: null },
    technicianPhone: { type: String, trim: true, default: null },
    site: { type: String, trim: true, default: null },
    scheduledFor: { type: Date, default: null, index: true },
    dispatchedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    resolutionNotes: { type: String, trim: true, default: null },
    metadata: { type: Object, default: {} },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

workOrderSchema.pre('validate', function normalizeWorkOrder() {
  if (this.orderNumber) this.orderNumber = String(this.orderNumber).trim().toUpperCase();
  if (this.summary) this.summary = String(this.summary).trim();
  if (this.technicianName) this.technicianName = String(this.technicianName).trim();
  if (this.technicianPhone) this.technicianPhone = String(this.technicianPhone).trim();
  if (this.site) this.site = String(this.site).trim();
  if (this.resolutionNotes) this.resolutionNotes = String(this.resolutionNotes).trim();

  if (this.status === 'completed' && !this.completedAt) {
    this.completedAt = new Date();
  }
  if (this.status === 'cancelled' && !this.cancelledAt) {
    this.cancelledAt = new Date();
  }
  if (this.status !== 'completed') {
    this.completedAt = null;
  }
  if (this.status !== 'cancelled') {
    this.cancelledAt = null;
  }
});

workOrderSchema.index({ tenantId: 1, orderNumber: 1 }, { unique: true });
workOrderSchema.index({ tenantId: 1, status: 1, priority: 1, scheduledFor: 1 });

module.exports = mongoose.model('WorkOrder', workOrderSchema);
