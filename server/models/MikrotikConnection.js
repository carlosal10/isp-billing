// models/MikroTikConnection.js
const mongoose = require("mongoose");

const MikroTikConnectionSchema = new mongoose.Schema(
  {
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    name: { type: String, required: true, trim: true, default: 'default' }, // human label (e.g., "HQ-Router")
    host: { type: String, required: true, trim: true },
    port: { type: Number, default: 8728, min: 1, max: 65535 },
    username: { type: String, required: true, trim: true },
    password: { type: String, required: true }, // store encrypted at rest if you have KMS
    tls: { type: Boolean, default: false },
    primary: { type: Boolean, default: false }, // mark one as default per tenant
    site: { type: String, trim: true },
    tags: { type: [String], default: [] },
    // optional metadata
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    lastVerifiedAt: { type: Date },
  },
  { timestamps: true }
);

// Basic host+port sanity
MikroTikConnectionSchema.path("host").validate(function (v) {
  return typeof v === "string" && v.length >= 3;
}, "Invalid host");

// Unique name per tenant (ignore docs missing name during migration)
MikroTikConnectionSchema.index(
  { tenant: 1, name: 1 },
  { unique: true, partialFilterExpression: { name: { $type: 'string', $ne: '' } } }
);
// Prevent duplicate host:port per tenant (ignore docs missing host)
MikroTikConnectionSchema.index(
  { tenant: 1, host: 1, port: 1 },
  { unique: true, partialFilterExpression: { host: { $type: 'string', $ne: '' }, port: { $type: 'number' } } }
);

module.exports = mongoose.model("MikroTikConnection", MikroTikConnectionSchema);
