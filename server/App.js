// App.js
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const path = require("path");
require("./jobs/expireAccess");
require("./jobs/smsReminders");

const app = express();

// ---- HTTP + Socket.IO ----
const http = require("http");
const { Server } = require("socket.io");
const server = http.createServer(app);

// ---- CORS origins (prod + local dev) ----
const CLIENT_ORIGIN = process.env.CLIENT_URL || "https://isp-billing-1-rsla.onrender.com";
const ALLOWED_ORIGINS = [
  CLIENT_ORIGIN,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
].filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // allow server-to-server / curl
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("CORS blocked (WS): " + origin));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-isp-id"],
    credentials: true,
  },
});

// ----------------- Middleware -----------------
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

// CORS (HTTP)
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("CORS blocked: " + origin));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-isp-id"],
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
    const isp = req.headers["x-isp-id"] || null;
    console.log(
      `[${req.method}] ${res.statusCode} ${req.originalUrl} ${dur}ms`,
      { sawAuth, isp }
    );
  });
  next();
});

// ----------------- MongoDB -----------------
mongoose
  .connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 })
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// ----------------- Auth Middlewares -----------------
const authenticate = (req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(204);
  const bearer = req.headers.authorization || "";
  const [, token] = bearer.split(" ");
  if (!token) return res.status(401).json({ ok: false, error: "Missing token" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET); // { sub/email/ispId, ... }
    next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: "Invalid or expired token" });
  }
};

const requireTenant = (req, res, next) => {
  const tenantId = req.headers["x-isp-id"] || req.user?.ispId;
  if (!tenantId) return res.status(401).json({ ok: false, error: "Missing tenant (x-isp-id)" });
  req.tenantId = String(tenantId);
  next();
};

// ----------------- Routes -----------------
// Core
const customerRoutes = require("./routes/Customer");
const planRoutes = require("./routes/plans");
const invoiceRoutes = require("./routes/Invoices");
const usageLogsRoutes = require("./routes/usageLogs");
const statsRoutes = require("./routes/Stats");

// Auth (HYBRID SPLIT)
const tenantAuthRoutes = require("./routes/tenantAuth");      // /api/auth/*
const invitesRoutes = require("./routes/invites");            // /api/invites (tenant-protected)
const platformAuthRoutes = require("./routes/platformAuth");  // /platform-api/auth/*

// MikroTik
const mikrotikUserRoutes = require("./routes/mikrotikUser");
const mikrotikConnectRoutes = require("./routes/mikrotikConnect");
const mikrotikRoutes = require("./routes/mikrotik");
const mikrotikTerminalRoutes = require("./routes/mikrotikTerminal");
const mikrotikAdminRoutes = require("./routes/mikrotikAdmin");

// Hotspot
const hotspotPlansRoutes = require("./routes/hotspotPlans");
const hotspotRoutes = require("./routes/hotspot");

// Payments
const paymentRoutes = require("./routes/payment");
const paymentCallbackRoutes = require("./routes/paymentCallback");
const paymentConfigRoutes = require("./routes/paymentConfig");
const mpesaSettingsRoutes = require("./routes/mpesaSettings");
const stripeWebhook = require("./routes/stripeWebhook");
const smsRoutes = require("./routes/sms");
const paylinkRoutes = require("./routes/paylink");
const paylinkAdminRoutes = require("./routes/paylinkAdmin");

// Debug
const debugRoutes = require("./routes/debug");
const tenantRoutes = require("./routes/tenant");
const accountRoutes = require("./routes/account");

// ----------------- Health -----------------
app.get("/api/health", (req, res) => res.json({ ok: true, version: "1.0.0" }));

// ----------------- Mount APIs -----------------
// Tenant realm auth
app.use("/api/auth", tenantAuthRoutes);
app.use("/api/invites", authenticate, requireTenant, invitesRoutes);

// Platform-admin realm
app.use("/platform-api/auth", platformAuthRoutes);

// Tenant-protected app APIs
app.use("/api/customers", authenticate, requireTenant, customerRoutes);
app.use("/api/plans", authenticate, requireTenant, planRoutes);
app.use("/api/invoices", authenticate, requireTenant, invoiceRoutes);
app.use("/api/usageLogs", authenticate, requireTenant, usageLogsRoutes);
app.use("/api/stats", authenticate, requireTenant, statsRoutes);
app.use("/api/tenant", authenticate, requireTenant, tenantRoutes);
app.use("/api/account", authenticate, accountRoutes);

// MikroTik PPPoE & connectivity
app.use("/api/pppoe", authenticate, requireTenant, mikrotikUserRoutes);
app.use("/api/connect", authenticate, requireTenant, mikrotikConnectRoutes);
app.use("/api", authenticate, requireTenant, mikrotikRoutes);

// Terminal: allow OPTIONS, then auth
app.use(
  "/api/mikrotik/terminal",
  (req, res, next) => (req.method === "OPTIONS" ? res.sendStatus(204) : next()),
  authenticate,
  requireTenant,
  mikrotikTerminalRoutes
);

// Admin Mikrotik ops (whitelist, connection upsert/test)
app.use("/api/mikrotik/admin", authenticate, requireTenant, mikrotikAdminRoutes);

// Hotspot
app.use("/api/hotspot-plans", authenticate, requireTenant, hotspotPlansRoutes);
app.use("/api/hotspot", authenticate, requireTenant, hotspotRoutes);

// Payments & M-Pesa
app.use("/api/payments", authenticate, requireTenant, paymentRoutes);
app.use("/api/payment/callback", paymentCallbackRoutes);
app.use("/api/payment-config", authenticate, requireTenant, paymentConfigRoutes);
app.use("/api/mpesa-settings", authenticate, requireTenant, mpesaSettingsRoutes);
app.use("/api/payment/stripe", stripeWebhook);
// SMS settings/templates (tenant)
app.use("/api/sms", authenticate, requireTenant, smsRoutes);
// Public paylink endpoints
app.use("/api/paylink", paylinkRoutes);
// Admin/protected paylink helpers
app.use("/api/paylink/admin", authenticate, requireTenant, paylinkAdminRoutes);

// Debug (echo headers as seen *after* guards)
app.use("/api/debug", authenticate, requireTenant, debugRoutes);

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
  res.status(404).json({ ok: false, error: `Route not found: ${req.originalUrl}` })
);
app.use((err, req, res, next) => {
  console.error("🔥 Error:", err);
  res.status(500).json({ ok: false, error: "Internal server error" });
});

// ----------------- Start -----------------
const PORT = process.env.PORT || 5000;
// IMPORTANT: use server.listen so Socket.IO works
server.listen(PORT, () => console.log(`🚀 HTTP+WS server on http://localhost:${PORT}`));

module.exports = app;
