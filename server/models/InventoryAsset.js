'use strict';

const mongoose = require('mongoose');

const ASSET_KIND = [
  'cpe',
  'router',
  'switch',
  'radio',
  'onu',
  'ap',
  'server',
  'other',
];

const ASSET_STATUS = [
  'in_stock',
  'assigned',
  'spare',
  'maintenance',
  'faulty',
  'retired',
];

function normalizeMacAddress(value) {
  const raw = String(value || '').replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  if (raw.length !== 12) return value || null;
  return raw.match(/.{1,2}/g).join(':');
}

const inventoryAssetSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    assetTag: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ASSET_KIND, default: 'cpe', index: true },
    status: { type: String, enum: ASSET_STATUS, default: 'in_stock', index: true },
    vendor: { type: String, trim: true, default: null },
    model: { type: String, trim: true, default: null },
    serialNumber: { type: String, trim: true, default: null },
    macAddress: { type: String, trim: true, default: null },
    site: { type: String, trim: true, default: null },
    location: { type: String, trim: true, default: null },
    notes: { type: String, trim: true, default: null },
    managementIp: { type: String, trim: true, default: null },
    assignedCustomer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    installedAt: { type: Date, default: null },
    purchaseDate: { type: Date, default: null },
    metadata: { type: Object, default: {} },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

inventoryAssetSchema.pre('validate', function normalizeInventoryAsset() {
  if (this.assetTag) this.assetTag = String(this.assetTag).trim().toUpperCase();
  if (this.name) this.name = String(this.name).trim();
  if (this.vendor) this.vendor = String(this.vendor).trim();
  if (this.model) this.model = String(this.model).trim();
  if (this.serialNumber) this.serialNumber = String(this.serialNumber).trim().toUpperCase();
  if (this.site) this.site = String(this.site).trim();
  if (this.location) this.location = String(this.location).trim();
  if (this.managementIp) this.managementIp = String(this.managementIp).trim();
  this.macAddress = this.macAddress ? normalizeMacAddress(this.macAddress) : null;
});

inventoryAssetSchema.index({ tenantId: 1, assetTag: 1 }, { unique: true });
inventoryAssetSchema.index(
  { tenantId: 1, serialNumber: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { serialNumber: { $type: 'string' } },
  }
);
inventoryAssetSchema.index(
  { tenantId: 1, macAddress: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { macAddress: { $type: 'string' } },
  }
);

module.exports = mongoose.model('InventoryAsset', inventoryAssetSchema);
