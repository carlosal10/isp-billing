const express = require("express");
const {
  listCustomers,
  searchCustomers,
  findCustomerById,
  findCustomerByAccount,
} = require("../services/customerReadService");
const {
  anonymizeCustomer,
  buildCustomerAnonymizationPlan,
  exportCustomerPrivacyBundle,
  normalizePrivacyMode,
} = require("../services/customerPrivacyService");
const {
  getCustomerHealth,
  listDisabledCustomers,
} = require("../services/customerNetworkReadService");
const {
  createCustomer,
  updateCustomer,
  deleteCustomer,
} = require("../services/customerWriteService");
const requireRole = require("../middleware/requireRole");
const {
  getCustomerPortalAccess,
  updateCustomerPortalAccess,
} = require("../services/customerPortalAdminService");
const {
  serializeCommunicationPreferences,
  updateCustomerCommunicationPreferences,
} = require("../services/customerCommunicationPreferencesService");

const router = express.Router();

function requestActor(req) {
  return {
    id: String(req.user?.email || req.user?.sub || req.user?.id || req.user?._id || ''),
    email: req.user?.email || null,
    role: req.role || (req.user?.isPlatformAdmin ? 'platform-admin' : null),
  };
}

function requestedPrivacyMode(query = {}, fallback = "full") {
  const hasExplicitMode = query.privacyMode != null && String(query.privacyMode).trim() !== "";
  const explicitMode = hasExplicitMode ? normalizePrivacyMode(query.privacyMode) : null;
  const wantsMasking =
    explicitMode === "masked" ||
    String(query.mask || "").toLowerCase() === "true" ||
    String(query.maskSensitive || "").toLowerCase() === "true";
  if (wantsMasking) return "masked";
  if (explicitMode === "full") return "full";
  return fallback;
}

router.get("/", async (req, res) => {
  try {
    const customers = await listCustomers(req.tenantId, {
      privacyMode: requestedPrivacyMode(req.query),
    });
    res.json(customers);
  } catch (err) {
    console.error("list customers error:", err);
    res.status(500).json({ message: "Failed to retrieve customers" });
  }
});

router.get("/search", async (req, res) => {
  try {
    const customers = await searchCustomers(req.tenantId, req.query?.query, {
      privacyMode: requestedPrivacyMode(req.query),
    });
    res.json(customers);
  } catch (err) {
    console.error("customer search failed:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

router.get("/by-id/:id", async (req, res) => {
  try {
    const customer = await findCustomerById(req.tenantId, req.params.id, {
      privacyMode: requestedPrivacyMode(req.query),
    });
    if (!customer) return res.status(404).json({ message: "Customer not found" });
    res.json(customer);
  } catch (err) {
    console.error("by-id error:", err);
    res.status(500).json({ message: "Error retrieving customer" });
  }
});

router.get("/by-account/:accountNumber", async (req, res) => {
  try {
    const customer = await findCustomerByAccount(req.tenantId, req.params.accountNumber, {
      privacyMode: requestedPrivacyMode(req.query),
    });
    if (!customer) return res.status(404).json({ message: "Customer not found" });
    res.json(customer);
  } catch (err) {
    console.error("by-account error:", err);
    res.status(500).json({ message: "Error retrieving customer" });
  }
});

router.get("/:id/portal-access", async (req, res) => {
  try {
    const access = await getCustomerPortalAccess(req.tenantId, req.params.id);
    res.json(access);
  } catch (err) {
    console.error("customer portal access read failed:", err);
    return res.status(err?.statusCode || 500).json({ message: err?.message || "Failed to load portal access" });
  }
});

async function updatePortalAccessHandler(req, res) {
  try {
    const access = await updateCustomerPortalAccess({
      tenantId: req.tenantId,
      customerId: req.params.id,
      payload: req.body || {},
      actor: requestActor(req),
    });
    res.json({ message: "Customer portal access updated", access });
  } catch (err) {
    console.error("customer portal access update failed:", err);
    return res.status(err?.statusCode || 500).json({ message: err?.message || "Failed to update portal access" });
  }
}

router.put("/:id/portal-access", requireRole("owner", "admin"), updatePortalAccessHandler);
router.patch("/:id/portal-access", requireRole("owner", "admin"), updatePortalAccessHandler);

router.get("/:id/communication-preferences", async (req, res) => {
  try {
    const customer = await findCustomerById(req.tenantId, req.params.id);
    if (!customer) return res.status(404).json({ message: "Customer not found" });
    return res.json({
      customerId: String(customer._id),
      accountNumber: customer.accountNumber || null,
      name: customer.name || null,
      communicationPreferences: serializeCommunicationPreferences(customer),
    });
  } catch (err) {
    console.error("customer communication preferences read failed:", err);
    return res.status(err?.statusCode || 500).json({ message: err?.message || "Failed to load communication preferences" });
  }
});

async function updateCommunicationPreferencesHandler(req, res) {
  try {
    const preferences = await updateCustomerCommunicationPreferences({
      tenantId: req.tenantId,
      customerId: req.params.id,
      payload: req.body || {},
      actor: requestActor(req),
    });
    res.json({ message: "Customer communication preferences updated", preferences });
  } catch (err) {
    console.error("customer communication preferences update failed:", err);
    return res.status(err?.statusCode || 500).json({ message: err?.message || "Failed to update communication preferences" });
  }
}

router.put("/:id/communication-preferences", requireRole("owner", "admin"), updateCommunicationPreferencesHandler);
router.patch("/:id/communication-preferences", requireRole("owner", "admin"), updateCommunicationPreferencesHandler);

router.get("/:id/privacy/export", requireRole("owner", "admin"), async (req, res) => {
  try {
    const bundle = await exportCustomerPrivacyBundle({
      tenantId: req.tenantId,
      customerId: req.params.id,
      privacyMode: requestedPrivacyMode(req.query, "masked"),
      limit: req.query.limit,
    });
    res.json(bundle);
  } catch (err) {
    console.error("customer privacy export failed:", err);
    return res.status(err?.statusCode || 500).json({ message: err?.message || "Failed to export customer privacy data" });
  }
});

router.get("/:id/privacy/anonymization-plan", requireRole("owner", "admin"), async (req, res) => {
  try {
    const plan = await buildCustomerAnonymizationPlan({
      tenantId: req.tenantId,
      customerId: req.params.id,
    });
    res.json(plan);
  } catch (err) {
    console.error("customer anonymization plan failed:", err);
    return res.status(err?.statusCode || 500).json({ message: err?.message || "Failed to build anonymization plan" });
  }
});

router.post("/:id/privacy/anonymize", requireRole("owner", "admin"), async (req, res) => {
  try {
    const result = await anonymizeCustomer({
      tenantId: req.tenantId,
      customerId: req.params.id,
      confirmation: req.body?.confirmation,
      reason: req.body?.reason,
      actor: requestActor(req),
    });
    res.json(result);
  } catch (err) {
    console.error("customer anonymization failed:", err);
    return res.status(err?.statusCode || 500).json({ message: err?.message || "Failed to anonymize customer" });
  }
});

router.post("/", async (req, res) => {
  try {
    const customer = await createCustomer({
      tenantId: req.tenantId,
      payload: req.body,
      requestMeta: {
        auth: req.auth,
        originalUrl: req.originalUrl,
        headers: req.headers,
      },
    });
    res.status(201).json({ message: "Customer created successfully", customer });
  } catch (err) {
    console.error("Create customer failed:", err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    return res.status(400).json({ message: `Failed to create customer: ${err.message}` });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const customer = await updateCustomer({
      tenantId: req.tenantId,
      customerId: req.params.id,
      payload: req.body,
    });
    res.json({ message: "Customer updated successfully", customer });
  } catch (err) {
    console.error("Update customer failed:", err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    return res.status(400).json({ message: `Failed to update customer: ${err.message}` });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await deleteCustomer({
      tenantId: req.tenantId,
      customerId: req.params.id,
    });
    res.json({ message: "Customer deleted successfully" });
  } catch (err) {
    console.error("Delete customer failed:", err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    return res.status(500).json({ message: `Error deleting customer: ${err.message}` });
  }
});

router.get("/health/:accountNumber", async (req, res) => {
  try {
    const accountNumber = String(req.params.accountNumber);
    const health = await getCustomerHealth(req.tenantId, accountNumber);
    if (!health) return res.status(404).json({ ok: false, error: "Customer not found" });
    return res.json(health);
  } catch (e) {
    console.error("health endpoint failed:", e?.message || e);
    return res.status(500).json({ ok: false, error: "Failed to fetch health" });
  }
});

router.get("/disabled", async (req, res) => {
  try {
    const disabled = await listDisabledCustomers(req.tenantId);
    return res.json(disabled);
  } catch (e) {
    console.error("list disabled failed:", e?.message || e);
    return res.status(500).json({ ok: false, error: "Failed to load disabled users" });
  }
});

module.exports = router;
