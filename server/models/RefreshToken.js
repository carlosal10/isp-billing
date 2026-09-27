// server/models/RefreshToken.js
const mongoose = require("mongoose");

const RefreshTokenSchema = new mongoose.Schema(
  {
    // New records store a SHA-256 digest. The field name is retained so the
    // existing unique index and pre-digest sessions remain migration-safe.
    token: { type: String, unique: true, required: true, index: true, select: false },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    isRevoked: { type: Boolean, default: false },
    revokedAt: { type: Date, default: null },
    // Optional explicit expiresAt; we’ll also add TTL for automatic cleanup
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// TTL index: Mongo will delete docs after expiresAt passes
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("RefreshToken", RefreshTokenSchema);
