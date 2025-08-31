const mongoose = require("mongoose");

const InviteSchema = new mongoose.Schema(
  {
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    email: { type: String, required: true, trim: true, index: true },
    role: { type: String, enum: ["admin", "operator", "billing", "viewer"], default: "operator" },
    code: { type: String, required: true, unique: true, index: true }, // signed or random
    expiresAt: { type: Date, required: true, index: true },
    acceptedAt: { type: Date },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// TTL for auto-expire (optional)
InviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("Invite", InviteSchema);
