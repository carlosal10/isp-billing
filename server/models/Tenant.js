// server/models/Tenant.js

const mongoose = require("mongoose");
const TenantSchema = new mongoose.Schema(
  {
    name: { type: String, unique: true, required: true, index: true },
    // Optional subdomain (e.g., acme => acme.<ROOT_DOMAIN>)
    subdomain: { type: String, unique: true, sparse: true, index: true },
  // Optional account number prefix, e.g., 'FML-' or 'FUNNET-'
  accountPrefix: { type: String, trim: true },
  // Optional pool of static IP addresses that can be automatically assigned to
  // customers with static connections. Each tenant can define a list of
  // available IP addresses here. When creating a new static customer without
  // specifying an IP, the system will allocate the next free IP from this
  // pool. IP addresses should be strings (e.g. "192.168.10.10").
  staticIpPool: {
    type: [String],
    default: [],
    validate: {
      validator: function (arr) {
        return Array.isArray(arr) && arr.every((item) => typeof item === 'string');
      },
      message: 'staticIpPool must be an array of strings',
    },
  },
  },
  { timestamps: true }
);
module.exports = mongoose.model("Tenant", TenantSchema);
