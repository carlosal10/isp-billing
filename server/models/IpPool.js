'use strict';

const mongoose = require('mongoose');
const { parseCidr, normalizeIPv4 } = require('../services/ipamMath');

const POOL_KIND = [
  'static',
  'management',
  'loopback',
  'hotspot',
  'pppoe',
  'infrastructure',
  'other',
];

const POOL_STATUS = ['active', 'disabled'];
const ALLOCATION_STRATEGY = ['cidr', 'list'];

function normalizeDnsList(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  return list
    .map((entry) => normalizeIPv4(entry))
    .filter(Boolean);
}

function normalizeAddressList(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(/[\n,\s]+/g);
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const ip = normalizeIPv4(entry);
    if (!ip || seen.has(ip)) continue;
    seen.add(ip);
    out.push(ip);
  }
  return out;
}

const ipPoolSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: POOL_KIND, default: 'static', index: true },
    status: { type: String, enum: POOL_STATUS, default: 'active', index: true },
    allocationStrategy: { type: String, enum: ALLOCATION_STRATEGY, default: 'cidr', index: true },
    cidr: { type: String, default: null, trim: true },
    networkAddress: { type: String, default: null, trim: true },
    prefixLength: { type: Number, default: null, min: 0, max: 32 },
    addressList: { type: [String], default: [] },
    gateway: { type: String, trim: true, default: null },
    dnsServers: { type: [String], default: [] },
    vlanId: { type: Number, default: null, min: 1, max: 4094 },
    site: { type: String, trim: true, default: null },
    notes: { type: String, trim: true, default: null },
    metadata: { type: Object, default: {} },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

ipPoolSchema.pre('validate', function normalizeIpPool() {
  this.gateway = this.gateway ? normalizeIPv4(this.gateway) : null;
  this.dnsServers = normalizeDnsList(this.dnsServers);
  if (this.allocationStrategy === 'list') {
    this.addressList = normalizeAddressList(this.addressList);
    if (!this.addressList.length) {
      throw new Error('Address list pools require at least one IPv4 address');
    }
    this.cidr = null;
    this.networkAddress = null;
    this.prefixLength = null;
    if (this.gateway && !this.addressList.includes(this.gateway)) {
      throw new Error('Gateway must be present in the address list for list-based pools');
    }
    return;
  }

  const parsed = parseCidr(this.cidr);
  this.cidr = parsed.cidr;
  this.networkAddress = parsed.networkAddress;
  this.prefixLength = parsed.prefixLength;
  this.addressList = [];
  if (this.gateway && !parsed.contains(this.gateway)) {
    throw new Error('Gateway must be inside the pool CIDR');
  }
});

ipPoolSchema.index({ tenantId: 1, name: 1 }, { unique: true });
ipPoolSchema.index(
  { tenantId: 1, cidr: 1 },
  {
    unique: true,
    partialFilterExpression: { cidr: { $type: 'string' } },
  }
);

module.exports = mongoose.model('IpPool', ipPoolSchema);
