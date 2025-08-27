// App.js
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require('./jobs/expireAccess');
const app = express();

// ----------------- Middleware -----------------
app.use(express.json());
app.use(
  cors({
    origin: process.env.CLIENT_URL || "https://isp-billing-1-rsla.onrender.com",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);

// ----------------- MongoDB Connection -----------------
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// ----------------- Authentication Middleware -----------------
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Access denied. No token provided" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: "Invalid token" });
  }
};

// ----------------- Routes -----------------
// Core
const customerRoutes = require("./routes/Customer");
const planRoutes = require("./routes/plans");
const invoiceRoutes = require("./routes/Invoices");
const usageLogsRoutes = require("./routes/usageLogs");
const adminAuthRoutes = require("./routes/AdminAuth");
const statsRoutes = require("./routes/Stats");

// MikroTik
const mikrotikUserRoutes = require("./routes/mikrotikUser");
const mikrotikConnectRoutes = require("./routes/mikrotikConnect");

// Hotspot
const hotspotPlansRoutes = require("./routes/hotspotPlans");
const hotspotRoutes = require("./routes/hotspot");

// Payments
const paymentRoutes = require("./routes/payment");             // STK push & manual
const paymentCallbackRoutes = require("./routes/paymentCallback"); // STK callback
const paymentConfigRoutes = require("./routes/paymentConfig");
const mpesaSettingsRoutes = require("./routes/mpesaSettings");
const stripeWebhook = require('./routes/stripeWebhook');



// ----------------- Mount APIs -----------------
app.use("/api/customers", customerRoutes);
app.use("/api/plans", planRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/usageLogs", usageLogsRoutes);
app.use("/api/auth", adminAuthRoutes);
app.use("/api/stats", statsRoutes);

// MikroTik PPPoE & connectivity
app.use("/api/pppoe", mikrotikUserRoutes);
app.use("/api/connect", mikrotikConnectRoutes);

// Hotspot plans
app.use("/api/hotspot-plans", hotspotPlansRoutes);
app.use("/api/hotspot", hotspotRoutes);

// Payments & M-Pesa
app.use("/api/payments", paymentRoutes);                       // main payments
app.use("/api/payment/callback", paymentCallbackRoutes);     // STK push callback
app.use("/api/payment-config", paymentConfigRoutes);
app.use("/api/mpesa-settings", mpesaSettingsRoutes);
app.use('/api/payment/stripe', stripeWebhook);


// ----------------- 404 Handler -----------------
app.use((req, res) => {
  res.status(404).json({ message: `Route not found: ${req.originalUrl}` });
});

// ----------------- Error Handler -----------------
app.use((err, req, res, next) => {
  console.error("🔥 Error:", err.message);
  res.status(500).json({ message: "Internal server error" });
});

// ----------------- Start Server -----------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

module.exports = app;
