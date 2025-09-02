// routes/debug.js
const express = require("express");
const router = express.Router();

router.get("/whoami", (req, res) => {
  res.json({
    ok: true,
    userFromJwt: req.user || null,
    tenantId: req.tenantId || null,
    sawAuthHeader: Boolean(req.headers.authorization),
    sawIspIdHeader: req.headers["x-isp-id"] || null,
  });
});

module.exports = router;
