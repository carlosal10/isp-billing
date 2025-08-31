// server/models/Membership.js
const mongoose = require("mongoose");

const MembershipSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    role: { type: String, enum: ["owner", "admin", "operator"], default: "operator" },
  },
  { timestamps: true }
);

MembershipSchema.index({ user: 1, tenant: 1 }, { unique: true });

module.exports = mongoose.model("Membership", MembershipSchema);
