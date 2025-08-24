// App.js
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");

const app = express();

// ----------------- Middleware -----------------
app.use(express.json());
app.use(
  cors({
    origin: process.env.CLIENT_URL || "https://isp-billing-1-rsla.onrender.com", // frontend URL
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

  if (!token) {
    return res.status(401).json({ message: "Access denied. No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: "Invalid token" });
  }
};

// ----------------- Routes -----------------
const customerRoutes = require("./routes/Customer");
const planRoutes = require("./routes/plans");
const invoiceRoutes = require("./routes/Invoices");
const usageLogsRoutes = require("./routes/usageLogs");
const adminAuthRoutes = require("./routes/AdminAuth");
const statsRoutes = require("./routes/Stats");
const mikrotikUserRoutes = require("./routes/mikrotikUser");
const mikrotikConnect = require("./routes/mikrotikConnect");
const hotspotPlansRouter = require("./routes/hotspotPlans");
const hotspotRoutes = require("./routes/hotspot");
const mpesaConfigRoutes = require("./routes/mpesaConfig");
const paymentRoutes = require("./routes/payment");
const callbackRoutes = require("./routes/paymentCallback");

app.use("/api/customers", customerRoutes);
app.use("/api/plans", planRoutes);
app.use("/api/invoices", invoiceRoutes); // lowercase for consistency
app.use("/api/usageLogs", usageLogsRoutes);
app.use("/api/auth", adminAuthRoutes);
app.use("/api", statsRoutes);
app.use("/api/mikrotik/users", mikrotikUserRoutes);
app.use("/api/connect", mikrotikConnect);
app.use("/api/hotspot-plans", hotspotPlansRouter);
app.use("/api/hotspot", hotspotRoutes);
app.use("/api/mpesa-config", mpesaConfigRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/payment", callbackRoutes);

console.log("🔗 /api/connect route registered");

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
