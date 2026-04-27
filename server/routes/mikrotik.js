const express = require("express");
const rateLimit = require("express-rate-limit");

const mikrotikReadService = require("../services/mikrotikReadService");
const mikrotikWriteService = require("../services/mikrotikWriteService");
const { pickServerId } = require("../services/mikrotikSupport");

const router = express.Router();
const limiter = rateLimit({ windowMs: 5_000, max: 20, standardHeaders: true });

function buildReadContext(req) {
  return {
    tenantId: req.tenantId,
    serverId: pickServerId(req),
    query: req.query,
  };
}

function jsonRoute(handler) {
  return async (req, res, next) => {
    try {
      const payload = await handler(req);
      res.json(payload);
    } catch (error) {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({
          ok: false,
          error: error.message || "Request failed",
        });
      }
      next(error);
    }
  };
}

const statusHandler = jsonRoute((req) => mikrotikReadService.getRouterStatus(buildReadContext(req)));
const pingHandler = jsonRoute((req) => mikrotikReadService.getRouterPing(buildReadContext(req)));
const pppoeActiveHandler = jsonRoute((req) => mikrotikReadService.listPppoeActive(buildReadContext(req)));
const hotspotActiveHandler = jsonRoute((req) => mikrotikReadService.listHotspotActive(buildReadContext(req)));
const simpleQueuesHandler = jsonRoute((req) => mikrotikReadService.listSimpleQueues(buildReadContext(req)));
const arpHandler = jsonRoute((req) => mikrotikReadService.listArpEntries(buildReadContext(req)));
const staticCandidatesHandler = jsonRoute((req) => mikrotikReadService.listStaticCandidates(buildReadContext(req)));
const staticActiveHandler = jsonRoute((req) => mikrotikReadService.listStaticActive(buildReadContext(req)));
const onlineCountsHandler = jsonRoute((req) => mikrotikReadService.getOnlineCounts(buildReadContext(req)));
const enablePppoeHandler = jsonRoute((req) =>
  mikrotikWriteService.enablePppoeAccount({
    tenantId: req.tenantId,
    serverId: pickServerId(req),
    account: req.params.account,
  })
);
const disablePppoeHandler = jsonRoute((req) =>
  mikrotikWriteService.disablePppoeAccount({
    tenantId: req.tenantId,
    serverId: pickServerId(req),
    account: req.params.account,
    disconnect: String(req.query.disconnect || "true").toLowerCase() !== "false",
  })
);
const applyStaticQueueHandler = jsonRoute((req) =>
  mikrotikWriteService.applyStaticQueue({
    tenantId: req.tenantId,
    serverId: pickServerId(req),
    account: req.params.account,
    rateLimit: req.body.rateLimit,
    target: req.body.target,
  })
);
const enableStaticQueueHandler = jsonRoute((req) =>
  mikrotikWriteService.enableStaticQueue({
    tenantId: req.tenantId,
    serverId: pickServerId(req),
    account: req.params.account,
  })
);
const disableStaticQueueHandler = jsonRoute((req) =>
  mikrotikWriteService.disableStaticQueue({
    tenantId: req.tenantId,
    serverId: pickServerId(req),
    account: req.params.account,
  })
);

router.get("/mikrotik/status", limiter, statusHandler);
router.get("/mikrotik/ping", limiter, pingHandler);
router.get("/mikrotik/pppoe/active", limiter, pppoeActiveHandler);
router.get("/pppoe/active", limiter, pppoeActiveHandler);
router.get("/mikrotik/hotspot/active", limiter, hotspotActiveHandler);
router.get("/hotspot/active", limiter, hotspotActiveHandler);
router.get("/mikrotik/queues/simple", limiter, simpleQueuesHandler);
router.get("/queues/simple", limiter, simpleQueuesHandler);
router.get("/mikrotik/arp", limiter, arpHandler);
router.get("/arp", limiter, arpHandler);
router.get("/mikrotik/static/candidates", limiter, staticCandidatesHandler);
router.get("/static/candidates", limiter, staticCandidatesHandler);
router.get("/mikrotik/static/active", limiter, staticActiveHandler);
router.get("/static/active", limiter, staticActiveHandler);
router.get("/mikrotik/online", limiter, onlineCountsHandler);
router.post("/pppoe/:account/enable", limiter, enablePppoeHandler);
router.post("/pppoe/:account/disable", limiter, disablePppoeHandler);
router.post("/static/:account/apply-queue", limiter, applyStaticQueueHandler);
router.post("/static/:account/enable-queue", limiter, enableStaticQueueHandler);
router.post("/static/:account/disable-queue", limiter, disableStaticQueueHandler);

module.exports = router;
