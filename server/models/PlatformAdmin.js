const mongoose = require("mongoose");

const PlatformAdminSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, index: true, trim: true },
    username: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    isSuper: { type: Boolean, default: false },
    // Existing access tokens are invalidated when this version changes or
    // when a revocation timestamp is recorded. Keep the account active state
    // separate so an admin can be disabled without deleting audit history.
    isActive: { type: Boolean, default: true, index: true },
    sessionVersion: { type: Number, default: 0, min: 0 },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PlatformAdmin", PlatformAdminSchema);
