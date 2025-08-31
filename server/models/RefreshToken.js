// server/models/RefreshToken.js
const mongoose = require("mongoose");

const RefreshTokenSchema = new mongoose.Schema(
  {
    token: { type: String, unique: true, required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    isRevoked: { type: Boolean, default: false },
    // Optional explicit expiresAt; we’ll also add TTL for automatic cleanup
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

// TTL index: Mongo will delete docs after expiresAt passes
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("RefreshToken", RefreshTokenSchema);
