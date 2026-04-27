const express = require("express");
const User = require("../models/User");
const Membership = require("../models/Membership");
const requireAuth = require("../middleware/requireAuth");
const requireTenant = require("../middleware/requireTenant");

const router = express.Router();

router.get("/", requireAuth, requireTenant, async (req, res) => {
  try {
    const { q, page = "1", size = "20" } = req.query;
    const limit = Math.min(100, Math.max(1, Number(size)));
    const skip = (Math.max(1, Number(page)) - 1) * limit;

    const memberUserIds = await Membership.find({ tenant: req.tenantId }).distinct("user");
    const where = {
      _id: { $in: memberUserIds },
      ...(q
        ? {
            $or: [
              { email: new RegExp(String(q), "i") },
              { displayName: new RegExp(String(q), "i") },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      User.find(where, { email: 1, displayName: 1, isActive: 1, createdAt: 1 })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(where),
    ]);

    return res.json({ ok: true, items, total, page: Number(page), size: limit });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Failed to load users" });
  }
});

module.exports = router;
