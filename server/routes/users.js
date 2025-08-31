// server/routes/users.js
import { Router } from "express";
import User from "../models/User.js";
import Membership from "../models/Membership.js";
import { requireAuth, requireTenant } from "../security/auth.js";

const router = Router();

router.get("/", requireAuth, requireTenant, async (req, res) => {
  const { q, page = "1", size = "20" } = req.query;
  const limit = Math.min(100, Math.max(1, Number(size)));
  const skip = (Math.max(1, Number(page)) - 1) * limit;

  // find users who are members of req.tenantId
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

  res.json({ ok: true, items, total, page: Number(page), size: limit });
});

export default router;
