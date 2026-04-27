const express = require("express");
const {
  listCustomers,
  searchCustomers,
  findCustomerById,
  findCustomerByAccount,
} = require("../services/customerReadService");
const {
  getCustomerHealth,
  listDisabledCustomers,
} = require("../services/customerNetworkReadService");
const {
  createCustomer,
  updateCustomer,
  deleteCustomer,
} = require("../services/customerWriteService");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const customers = await listCustomers(req.tenantId);
    res.json(customers);
  } catch (err) {
    console.error("list customers error:", err);
    res.status(500).json({ message: "Failed to retrieve customers" });
  }
});

router.get("/search", async (req, res) => {
  try {
    const customers = await searchCustomers(req.tenantId, req.query?.query);
    res.json(customers);
  } catch (err) {
    console.error("customer search failed:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

router.get("/by-id/:id", async (req, res) => {
  try {
    const customer = await findCustomerById(req.tenantId, req.params.id);
    if (!customer) return res.status(404).json({ message: "Customer not found" });
    res.json(customer);
  } catch (err) {
    console.error("by-id error:", err);
    res.status(500).json({ message: "Error retrieving customer" });
  }
});

router.get("/by-account/:accountNumber", async (req, res) => {
  try {
    const customer = await findCustomerByAccount(req.tenantId, req.params.accountNumber);
    if (!customer) return res.status(404).json({ message: "Customer not found" });
    res.json(customer);
  } catch (err) {
    console.error("by-account error:", err);
    res.status(500).json({ message: "Error retrieving customer" });
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
