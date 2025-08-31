// models/MikroTikConnection.js
const mongoose = require("mongoose");

const MikroTikConnectionSchema = new mongoose.Schema(
  {
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true, unique: true },
    host: { type: String, required: true, trim: true },
    port: { type: Number, default: 8728, min: 1, max: 65535 },
    username: { type: String, required: true, trim: true },
    password: { type: String, required: true }, // store encrypted at rest if you have KMS
    tls: { type: Boolean, default: false },
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

module.exports = mongoose.model("MikroTikConnection", MikroTikConnectionSchema);
