'use strict';

const mongoose = require('mongoose');
const {
  INCIDENT_KIND,
  INCIDENT_SEVERITY,
  INCIDENT_STATUS,
  normalizeIncidentKind,
  normalizeIncidentSeverity,
  normalizeIncidentStatus,
} = require('../services/nocMath');

const incidentUpdateSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    author: { type: String, trim: true, default: null },
    body: { type: String, trim: true, required: true },
  },
  { _id: false }
);

const nocIncidentSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    incidentNumber: { type: String, trim: true, required: true, index: true },
    title: { type: String, trim: true, required: true },
    summary: { type: String, trim: true, default: null },
    kind: { type: String, enum: INCIDENT_KIND, default: 'outage', index: true },
    severity: { type: String, enum: INCIDENT_SEVERITY, default: 'medium', index: true },
    status: { type: String, enum: INCIDENT_STATUS, default: 'open', index: true },
    site: { type: String, trim: true, default: null },
    routerName: { type: String, trim: true, default: null },
    detectedAt: { type: Date, default: Date.now, index: true },
    startedAt: { type: Date, default: Date.now, index: true },
    plannedStart: { type: Date, default: null },
    plannedEnd: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    affectedCustomers: { type: [mongoose.Schema.Types.ObjectId], ref: 'Customer', default: [] },
    affectedAssets: { type: [mongoose.Schema.Types.ObjectId], ref: 'InventoryAsset', default: [] },
    updates: { type: [incidentUpdateSchema], default: [] },
    tags: { type: [String], default: [] },
    notificationState: { type: String, trim: true, default: 'not_started' },
    metadata: { type: Object, default: {} },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

nocIncidentSchema.pre('validate', function normalizeNocIncident() {
  if (this.incidentNumber) this.incidentNumber = String(this.incidentNumber).trim().toUpperCase();
  if (this.title) this.title = String(this.title).trim();
  if (this.summary) this.summary = String(this.summary).trim();
  if (this.site) this.site = String(this.site).trim();
  if (this.routerName) this.routerName = String(this.routerName).trim();

  this.kind = normalizeIncidentKind(this.kind);
  this.severity = normalizeIncidentSeverity(this.severity);
  this.status = normalizeIncidentStatus(this.kind, this.status);
  this.tags = Array.isArray(this.tags)
    ? Array.from(new Set(this.tags.map((tag) => String(tag || '').trim()).filter(Boolean)))
    : [];

  if (this.status === 'resolved' && !this.resolvedAt) {
    this.resolvedAt = new Date();
  }
  if (this.status === 'closed' && !this.closedAt) {
    this.closedAt = new Date();
  }
  if (!['resolved', 'closed'].includes(this.status)) {
    this.resolvedAt = null;
  }
  if (this.status !== 'closed') {
    this.closedAt = null;
  }
});

nocIncidentSchema.index({ tenantId: 1, incidentNumber: 1 }, { unique: true });
nocIncidentSchema.index({ tenantId: 1, status: 1, severity: 1, startedAt: -1 });

module.exports = mongoose.model('NocIncident', nocIncidentSchema);
