const express = require("express");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const {
  isAllowed,
  parseCli,
  redactCommand,
  sendCommand: sendTerminalCommand,
} = require("../services/terminal");

const router = express.Router();

router.options("/exec", (req, res) => res.sendStatus(204));

const limiter = rateLimit({
  windowMs: 10 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const Body = z.object({
  command: z.string().min(1).max(512),
  timeoutMs: z.number().int().min(500).max(60000).optional(),
  serverId: z.string().optional(),
});

router.post("/exec", limiter, async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ ok: false, error: "Missing tenant (x-isp-id)" });
    }

    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "Invalid payload" });
    }

    const { command, timeoutMs = 10000, serverId: bodyServer } = parsed.data;
    const { path, words } = parseCli(command);
    if (!isAllowed(path)) {
      return res.status(403).json({ ok: false, error: `Command not allowed: ${path}` });
    }

    console.log("MikroTik terminal exec:", redactCommand(command));

    const headerServer = req.headers["x-isp-server"] || req.headers["x-router-id"] || null;
    const serverId = bodyServer || headerServer || req.query?.serverId || null;
    const result = await sendTerminalCommand(tenantId, path, words, { timeoutMs, serverId });

    return res.json({ ok: true, path, words, result });
  } catch (err) {
    const msg = err?.message || "RouterOS exec failed";
    const isUpstream = /timeout|expired|auth|EHOSTUNREACH|ECONNREFUSED|network/i.test(msg);
    return res.status(isUpstream ? 502 : 500).json({ ok: false, error: msg });
  }
});

module.exports = router;
