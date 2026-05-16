// App.js
require("dotenv").config();
if (process.env.MPESA_CALLBACK_URL) {
  process.env.MPESA_CALLBACK_URL = process.env.MPESA_CALLBACK_URL.trim();
}
const { validateEnv } = require("./utils/env");
validateEnv();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require('cookie-parser');
const path = require("path");
const { buildBaseUrl } = require("./utils/paylink");
const requireAuth = require("./middleware/requireAuth");
const requireTenant = require("./middleware/requireTenant");
const requirePlatformAdmin = require("./middleware/requirePlatformAdmin");
const { isPublicRequestPath } = require("./middleware/publicPaths");
const { requestContext } = require("./middleware/requestContext");
const { securityHeaders } = require("./middleware/securityHeaders");
const {
  requestMetricsMiddleware,
  requireMetricsAccess,
} = require("./middleware/requestMetrics");

const app = express();

// ---- HTTP + Socket.IO ----
const http = require("http");
const { Server } = require("socket.io");
const server = http.createServer(app);

// ---- CORS origins (prod + local dev) ----
function parseOrigins(value) {
  return String(value || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

const CLIENT_ORIGINS = parseOrigins(process.env.CLIENT_ORIGINS || process.env.CLIENT_URL);
const ALLOWED_ORIGINS = [
  ...CLIENT_ORIGINS,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://isp-billing-is9m.onrender.com",
  "https://isp-billing-1crk.onrender.com",
].filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // allow server-to-server / curl
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("CORS blocked (WS): " + origin));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-isp-id", "x-isp-server", "X-Request-ID"],
    credentials: true,
  },
});

// ----------------- Middleware -----------------
app.set("trust proxy", 1);
app.use(requestContext());
app.use(securityHeaders());
app.use(requestMetricsMiddleware());
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// CORS (HTTP)
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("CORS blocked: " + origin));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-isp-id","X-Requested-With", "x-isp-server", "X-API-KEY","Accept", "X-Request-ID"],
    exposedHeaders: ["X-Request-ID"],
    credentials: true,
    optionsSuccessStatus: 204,
  })
);

// Preflight early (Express 5): RegExp catch-all
app.options(/.*/, (req, res) => res.sendStatus(204));

// ---- Lightweight request logger (proves headers arrive) ----
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on("finish", () => {
    const dur = Date.now() - t0;
    const sawAuth = !!req.headers.authorization;
    const hasAtCookie = !!(req.cookies && req.cookies.at);
    const isp = req.headers["x-isp-id"] || null;
    console.log(
      `[${req.id}] [${req.method}] ${res.statusCode} ${req.originalUrl} ${dur}ms`,
      { sawAuth, hasAtCookie, isp }
    );
  });
  next();
});

// ----------------- MongoDB -----------------
mongoose
  .connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 })
  .then(async () => {
    console.log("✅ Connected to MongoDB Atlas");
    const { registerJobs } = require("./jobs/register");
    const { syncScheduledJobStates } = require("./utils/scheduler");
    registerJobs();
    await syncScheduledJobStates().catch((err) => {
      console.warn("[scheduler] failed to sync persisted job state", err?.message || err);
    });
  })
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// ----------------- Auth Middlewares -----------------
const authenticate = (req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(204);
  if (isPublicRequestPath(req.originalUrl || req.url || "")) return next();
  return requireAuth(req, res, next);
};

const attachTenant = (req, res, next) => {
  if (isPublicRequestPath(req.originalUrl || req.url || "")) return next();
  return requireTenant(req, res, next);
};

// ----------------- Routes -----------------
// Core
const customerRoutes = require("./routes/Customer");
const planRoutes = require("./routes/plans");
const invoiceRoutes = require("./routes/Invoices");
const financeRoutes = require("./routes/finance");
const auditLogRoutes = require("./routes/auditLogs");
const teamAccessRoutes = require("./routes/teamAccess");
const nocOperationsRoutes = require("./routes/nocOperations");
const opsHealthRoutes = require("./routes/opsHealth");
const serviceOperationsRoutes = require("./routes/serviceOperations");
const supportOperationsRoutes = require("./routes/supportOperations");
const usageLogsRoutes = require("./routes/usageLogs");
const statsRoutes = require("./routes/Stats");

// Auth (HYBRID SPLIT)
const tenantAuthRoutes = require("./routes/tenantAuth");      // /api/auth/*
const invitesRoutes = require("./routes/invites");
const platformAuthRoutes = require("./routes/platformAuth");  // /platform-api/auth/*
const portalAuthRoutes = require("./routes/portalAuth");
const customerPortalRoutes = require("./routes/customerPortal");
const platformGatewayEventsRoutes = require("./routes/platformGatewayEvents");

// MikroTik
const mikrotikUserRoutes = require("./routes/mikrotikUser");
const mikrotikConnectRoutes = require("./routes/mikrotikConnect");
const mikrotikServersRoutes = require("./routes/mikrotikServers");
const mikrotikRoutes = require("./routes/mikrotik");
const mikrotikTerminalRoutes = require("./routes/mikrotikTerminal");
const mikrotikAdminRoutes = require("./routes/mikrotikAdmin");
const staticControlRoutes = require("./routes/staticControl");
const queuesRoutes = require("./routes/queues");
const arpRoutes = require("./routes/arp");
const pppoeRoutes = require("./routes/pppoe");
const customersProfilesRoutes = require("./routes/customersProfiles");
const mikrotikProfilesRoutes = require("./routes/mikrotikProfiles");
const staticCandidatesRoutes = require("./routes/staticCandidates");

// Hotspot
const hotspotPlansRoutes = require("./routes/hotspotPlans");
const hotspotRoutes = require("./routes/hotspot");

// Payments
const paymentRoutes = require("./routes/payment");
const paymentCallbackRoutes = require("./routes/paymentCallback");
const paymentConfigRoutes = require("./routes/paymentConfig");
const mpesaC2BRoutes = require("./routes/mpesaC2B");
const mpesaSettingsRoutes = require("./routes/mpesaSettings");
const stripeWebhook = require("./routes/stripeWebhook");
const smsRoutes = require("./routes/sms");
const paylinkRoutes = require("./routes/paylink");
const paylinkAdminRoutes = require("./routes/paylinkAdmin");
const healthDetailRoutes = require("./routes/health");
const eventsRoutes = require("./routes/events");
const jobsRoutes = require("./routes/jobs");
const apiKeysRoutes = require("./routes/apiKeys");
const integrationApiRoutes = require("./routes/integrationApi");
const flagsRoutes = require("./routes/flags");
const archiveRoutes = require("./routes/archive");
const {
  buildLiveness,
  buildReadiness,
  readinessStatusCode,
} = require("./services/runtimeHealthService");
const {
  renderPrometheusMetrics,
  requestMetrics,
} = require("./services/requestMetricsService");
const { createProcessLifecycle } = require("./services/processLifecycleService");
const { shutdown: shutdownMikrotikPool } = require("./utils/mikrotikConnectionManager");

// Debug
const debugRoutes = require("./routes/debug");
const tenantRoutes = require("./routes/tenant");
const accountRoutes = require("./routes/account");
const fs = require('fs');

const lifecycle = createProcessLifecycle({
  server,
  mongooseInstance: mongoose,
  shutdownTasks: [
    {
      name: 'mikrotik-connection-pool',
      run: shutdownMikrotikPool,
    },
  ],
  timeoutMs: process.env.SHUTDOWN_TIMEOUT_MS,
  logger: console,
});

// ----------------- Health -----------------
app.get("/api/health", (req, res) => res.json(buildLiveness()));
app.use("/api/health", authenticate, attachTenant, healthDetailRoutes);
// Simple unauthenticated health endpoint (useful for external probes and CORS preflight)
app.get("/health", (req, res) => res.json(buildLiveness()));
app.get("/ready", (req, res) => {
  const report = buildReadiness({ mongooseInstance: mongoose, lifecycleState: lifecycle.state });
  res.status(readinessStatusCode(report)).json(report);
});
app.get("/metrics", requireMetricsAccess(), (req, res) => {
  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(renderPrometheusMetrics(requestMetrics.snapshot()));
});
// Serve OpenAPI (raw yaml)
app.get('/api/docs/openapi.yaml', (req, res) => {
  try {
    const p = path.resolve(__dirname, '../docs/openapi.yaml');
    res.setHeader('Content-Type', 'application/yaml');
    fs.createReadStream(p).pipe(res);
  } catch { res.status(404).end(); }
});
// Short paylink redirect (e.g., https://server/pl/<token>)
app.get('/pl/:token', (req, res) => {
  const token = req.params.token;
  if (!token) return res.status(400).send('Missing pay token');
  try {
    const base = buildBaseUrl();
    if (!base) {
      return res.redirect(302, `/pay?token=${encodeURIComponent(token)}`);
    }
    const target = `${base}/pay?token=${encodeURIComponent(token)}`;
    return res.redirect(302, target);
  } catch (err) {
    console.warn('[paylink-short] redirect failed', err?.message || err);
    return res.redirect(302, `/pay?token=${encodeURIComponent(token)}`);
  }
});
// NOTE: Defer mounting any generic '/api' guarded stacks until after public routes

// ----------------- Mount APIs -----------------
// Tenant realm auth
app.use("/api/auth", tenantAuthRoutes);
app.use("/api/invites", invitesRoutes);

// Platform-admin realm
app.use("/platform-api/auth", platformAuthRoutes);
app.use("/platform-api/gateway-events", requirePlatformAdmin, platformGatewayEventsRoutes);
app.use("/portal-api/auth", portalAuthRoutes);
app.use("/portal-api", customerPortalRoutes);

// Public paylink endpoints (must be before any generic /api auth wrappers)
app.use("/api/paylink", paylinkRoutes);
// Public payment provider callbacks (support both singular/plural path variations)
app.use("/api/payment/callback", paymentCallbackRoutes);
app.use("/api/payments/callback", paymentCallbackRoutes);
app.use("/api/payment/stripe", stripeWebhook);
app.use("/api/mpesa/c2b", mpesaC2BRoutes);
app.use("/api/integration", integrationApiRoutes);

// Now mount generic '/api' stacks and protected APIs
app.use("/api", authenticate, attachTenant, eventsRoutes);
app.use("/api", authenticate, attachTenant, jobsRoutes);
app.use("/api/api-keys", authenticate, attachTenant, apiKeysRoutes);
app.use("/api/flags", authenticate, attachTenant, flagsRoutes);
app.use("/api", authenticate, attachTenant, archiveRoutes);

// Tenant-protected app APIs
app.use("/api/customers", authenticate, attachTenant, customerRoutes);
app.use("/api/plans", authenticate, attachTenant, planRoutes);
app.use("/api/invoices", authenticate, attachTenant, invoiceRoutes);
app.use("/api/finance", authenticate, attachTenant, financeRoutes);
app.use("/api/audit-logs", authenticate, attachTenant, auditLogRoutes);
app.use("/api/team", authenticate, attachTenant, teamAccessRoutes);
app.use("/api/noc", authenticate, attachTenant, nocOperationsRoutes);
app.use("/api/ops-health", authenticate, attachTenant, opsHealthRoutes);
app.use("/api/service-ops", authenticate, attachTenant, serviceOperationsRoutes);
app.use("/api/support", authenticate, attachTenant, supportOperationsRoutes);
app.use("/api/usageLogs", authenticate, attachTenant, usageLogsRoutes);
app.use("/api/stats", authenticate, attachTenant, statsRoutes);
app.use("/api/tenant", authenticate, attachTenant, tenantRoutes);
app.use("/api/account", authenticate, accountRoutes);
app.use("/api/queues", authenticate, attachTenant, queuesRoutes);
app.use("/api/arp", authenticate, attachTenant, arpRoutes);
app.use("/api/pppoe", authenticate, attachTenant, pppoeRoutes);  
app.use("/api/customers", authenticate, attachTenant, customersProfilesRoutes);
app.use("/api/mikrotik", authenticate, attachTenant, mikrotikProfilesRoutes);
app.use("/api/static-candidates", authenticate, attachTenant, staticCandidatesRoutes);


// MikroTik PPPoE & connectivity
app.use("/api/pppoe", authenticate, attachTenant, mikrotikUserRoutes);
app.use("/api/connect", authenticate, attachTenant, mikrotikConnectRoutes);
app.use("/api", authenticate, attachTenant, mikrotikRoutes);

// Terminal: allow OPTIONS, then auth
app.use(
  "/api/mikrotik/terminal",
  (req, res, next) => (req.method === "OPTIONS" ? res.sendStatus(204) : next()),
  authenticate,
  attachTenant,
  mikrotikTerminalRoutes
);

// Admin Mikrotik ops (whitelist, connection upsert/test)
app.use("/api/mikrotik/admin", authenticate, attachTenant, mikrotikAdminRoutes);
app.use("/api/mikrotik/servers", authenticate, attachTenant, mikrotikServersRoutes);
// Static-IP migration & enforcement (monitor -> enforce)
app.use("/api/static", authenticate, attachTenant, staticControlRoutes);

// Hotspot
app.use("/api/hotspot-plans", authenticate, attachTenant, hotspotPlansRoutes);
app.use("/api/hotspot", authenticate, attachTenant, hotspotRoutes);

// Payments & M-Pesa
app.use("/api/payments", authenticate, attachTenant, paymentRoutes);
app.use("/api/payment-config", authenticate, attachTenant, paymentConfigRoutes);
app.use("/api/mpesa-settings", authenticate, attachTenant, mpesaSettingsRoutes);
// SMS settings/templates (tenant)
app.use("/api/sms", authenticate, attachTenant, smsRoutes);
// Admin/protected paylink helpers
app.use("/api/paylink/admin", authenticate, attachTenant, paylinkAdminRoutes);

// Debug (echo headers as seen *after* guards)
app.use("/api/debug", authenticate, attachTenant, debugRoutes);

// ----------------- Serve SPA (static build) -----------------
// Gate behind SERVE_CLIENT to avoid double-hosting when frontend is separate
if (String(process.env.SERVE_CLIENT).toLowerCase() === 'true') {
  try {
    const buildDir = path.resolve(__dirname, "../build");
    app.use(express.static(buildDir));
    // Rewrite non-API routes to index.html so deep-links refresh
    app.get(/^(?!\/(api|platform-api)\b).*$/, (req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(buildDir, "index.html"));
    });
  } catch {}
}

// ----------------- Socket.IO (namespaced terminal) -----------------
io.of("/terminal").use((socket, next) => {
  try {
    const { token, ispId } = socket.handshake.auth || {};
    if (!token) return next(new Error("Missing token"));
    const decoded = jwt.verify(token.split(" ")[1] || token, process.env.JWT_SECRET);
    socket.user = decoded;
    socket.tenantId = ispId || decoded.ispId;
    if (!socket.tenantId) return next(new Error("Missing tenant"));
    next();
  } catch (err) {
    return next(new Error("Unauthorized"));
  }
});

io.of("/terminal").on("connection", (socket) => {
  console.log("🔌 terminal connected", { user: socket.user?.sub, tenant: socket.tenantId });
  socket.on("exec", async ({ command }) => {
    try {
      const { parseCli, isAllowed, sendCommand } = require("./services/terminal");
      const { path, words } = parseCli(command);
      if (!isAllowed(path)) return socket.emit("error", `Not allowed: ${path}`);
      const result = await sendCommand(socket.tenantId, path, words);
      socket.emit("result", { command, result });
    } catch (e) {
      socket.emit("error", e?.message || "exec failed");
    }
  });
  socket.on("disconnect", () => console.log("🔌 terminal disconnected"));
});

// ----------------- 404 & Error -----------------
app.use((req, res) =>
  res.status(404).json({
    ok: false,
    error: `Route not found: ${req.originalUrl}`,
    requestId: req.id || null,
  })
);
app.use((err, req, res, next) => {
  console.error("🔥 Error:", { requestId: req.id || null, error: err });
  res.status(500).json({ ok: false, error: "Internal server error", requestId: req.id || null });
});
// ----------------- Start -----------------
const PORT = process.env.PORT || 5000;
// IMPORTANT: use server.listen so Socket.IO works
server.listen(PORT, () => console.log(`🚀 HTTP+WS server on http://localhost:${PORT}`));
lifecycle.installSignalHandlers();

module.exports = app;
