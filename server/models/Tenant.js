// server/models/Tenant.js

const mongoose = require("mongoose");
const TenantSchema = new mongoose.Schema(
  {
    name: { type: String, unique: true, required: true, index: true },
    // Optional subdomain (e.g., acme => acme.<ROOT_DOMAIN>)
    subdomain: { type: String, unique: true, sparse: true, index: true },
    // Optional account number prefix, e.g., 'FML-' or 'FUNNET-'
    accountPrefix: { type: String, trim: true },
  },
  { timestamps: true }
);
module.exports = mongoose.model("Tenant", TenantSchema);
