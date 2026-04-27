const Customer = require("../models/customers");

const CUSTOMER_PLAN_FIELDS = "name price duration speed";
const SEARCH_PLAN_FIELDS = "name speed price";
const SEARCH_CUSTOMER_FIELDS = {
  name: 1,
  accountNumber: 1,
  phone: 1,
  email: 1,
  address: 1,
  plan: 1,
};

async function listCustomers(tenantId) {
  return Customer.find({ tenantId })
    .populate("plan", CUSTOMER_PLAN_FIELDS)
    .lean();
}

async function searchCustomers(tenantId, query) {
  const q = String(query || "").trim();
  if (!q) return [];

  const regex = new RegExp(q, "i");
  return Customer.find(
    {
      tenantId,
      $or: [
        { name: regex },
        { accountNumber: regex },
        { email: regex },
        { phone: regex },
        { address: regex },
      ],
    },
    SEARCH_CUSTOMER_FIELDS
  )
    .limit(20)
    .populate("plan", SEARCH_PLAN_FIELDS)
    .lean();
}

async function findCustomerById(tenantId, customerId) {
  return Customer.findOne({ _id: customerId, tenantId })
    .populate("plan", CUSTOMER_PLAN_FIELDS)
    .lean();
}

async function findCustomerByAccount(tenantId, accountNumber) {
  return Customer.findOne({ accountNumber, tenantId })
    .populate("plan", CUSTOMER_PLAN_FIELDS)
    .lean();
}

module.exports = {
  listCustomers,
  searchCustomers,
  findCustomerById,
  findCustomerByAccount,
};
