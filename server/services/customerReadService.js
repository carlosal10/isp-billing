const Customer = require("../models/customers");
const {
  maskAccountNumber,
  maskEmail,
  maskIdentifier,
  maskPhone,
} = require("./privacyService");

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

function shouldMask(options = {}) {
  return options.privacyMode === "masked" || options.maskSensitive === true;
}

function serializeCustomerForAdmin(customer, options = {}) {
  if (!customer || !shouldMask(options)) return customer;
  const safe = { ...customer };
  safe.name = customer.name ? maskIdentifier(customer.name, { prefix: 1, suffix: 1 }) : null;
  safe.email = customer.email ? maskEmail(customer.email) : null;
  safe.phone = customer.phone ? maskPhone(customer.phone) : null;
  safe.address = customer.address ? "[anonymized]" : null;
  safe.accountNumber = customer.accountNumber ? maskAccountNumber(customer.accountNumber) : null;
  safe.accountAliases = Array.isArray(customer.accountAliases)
    ? customer.accountAliases.map(maskAccountNumber)
    : [];
  if (safe.billingProfile) {
    safe.billingProfile = {
      ...safe.billingProfile,
      preferredPhoneNumber: safe.billingProfile.preferredPhoneNumber
        ? maskPhone(safe.billingProfile.preferredPhoneNumber)
        : null,
      stripeCustomerId: safe.billingProfile.stripeCustomerId
        ? maskIdentifier(safe.billingProfile.stripeCustomerId)
        : null,
      stripePaymentMethodId: safe.billingProfile.stripePaymentMethodId
        ? maskIdentifier(safe.billingProfile.stripePaymentMethodId)
        : null,
    };
  }
  return safe;
}

async function listCustomers(tenantId, options = {}) {
  const rows = await Customer.find({ tenantId })
    .select({ 'portalProfile.pinHash': 0 })
    .populate("plan", CUSTOMER_PLAN_FIELDS)
    .lean();
  return rows.map((customer) => serializeCustomerForAdmin(customer, options));
}

async function searchCustomers(tenantId, query, options = {}) {
  const q = String(query || "").trim();
  if (!q) return [];

  const regex = new RegExp(q, "i");
  const rows = await Customer.find(
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
  return rows.map((customer) => serializeCustomerForAdmin(customer, options));
}

async function findCustomerById(tenantId, customerId, options = {}) {
  const customer = await Customer.findOne({ _id: customerId, tenantId })
    .select({ 'portalProfile.pinHash': 0 })
    .populate("plan", CUSTOMER_PLAN_FIELDS)
    .lean();
  return serializeCustomerForAdmin(customer, options);
}

async function findCustomerByAccount(tenantId, accountNumber, options = {}) {
  const customer = await Customer.findOne({ accountNumber, tenantId })
    .select({ 'portalProfile.pinHash': 0 })
    .populate("plan", CUSTOMER_PLAN_FIELDS)
    .lean();
  return serializeCustomerForAdmin(customer, options);
}

module.exports = {
  listCustomers,
  searchCustomers,
  findCustomerById,
  findCustomerByAccount,
  serializeCustomerForAdmin,
};
