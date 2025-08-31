const mongoose = require("mongoose");

const PlatformAdminSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, index: true, trim: true },
    username: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    isSuper: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PlatformAdmin", PlatformAdminSchema);
