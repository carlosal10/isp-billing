const Payment = require("../models/Payment");
const Customer = require("../models/customers");
const PaymentGatewayEvent = require("../models/PaymentGatewayEvent");

function isTruthyQueryFlag(value) {
  return /^(1|true|yes)$/i.test(String(value || ""));
}

async function searchPayments(tenantId, query) {
  const q = String(query || "").trim();
  if (!q) return [];

  const regex = new RegExp(q, "i");
  const customers = await Customer.find(
    {
      tenantId,
      $or: [{ name: regex }, { accountNumber: regex }, { phone: regex }, { email: regex }],
    },
    { _id: 1, name: 1, accountNumber: 1 }
  )
    .limit(20)
    .lean();

  if (customers.length === 0) return [];

  const customerIds = customers.map((customer) => customer._id);
  const payments = await Payment.find({
    tenantId,
    customer: { $in: customerIds },
    isDeleted: { $ne: true },
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate("customer", "name accountNumber")
    .populate("plan", "name")
    .lean();

  return payments.map((payment) => ({
    _id: payment._id,
    accountNumber: payment.accountNumber,
    customerName: payment.customer?.name,
    amount: payment.amount,
    method: payment.method,
    status: payment.status,
    createdAt: payment.createdAt,
  }));
}

async function listPayments(tenantId, options = {}) {
  const limit = Math.min(Number(options.limit) || 200, 500);
  const includeDeleted = isTruthyQueryFlag(options.includeDeleted);
  const filter = { tenantId };
  if (!includeDeleted) filter.isDeleted = { $ne: true };

  const payments = await Payment.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("customer", "name accountNumber connectionType")
    .populate("plan", "name price duration durationDays")
    .lean();

  return payments.map((payment) => ({
    ...payment,
    customerName: payment.customer?.name || null,
    accountNumber: payment.accountNumber || payment.customer?.accountNumber || null,
  }));
}

async function listGatewayEvents(tenantId, options = {}) {
  const limit = Math.min(Number(options.limit) || 50, 200);
  const filter = { tenantId };
  if (options.provider) filter.provider = String(options.provider);
  if (options.kind) filter.kind = String(options.kind);
  if (options.eventStatus) filter.eventStatus = String(options.eventStatus);
  if (options.paymentId) filter.paymentId = String(options.paymentId);

  return PaymentGatewayEvent.find(filter)
    .select({ payload: 0, headers: 0 })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

async function getGatewayEvent(tenantId, eventId) {
  return PaymentGatewayEvent.findOne({ _id: eventId, tenantId }).lean();
}

module.exports = {
  searchPayments,
  listPayments,
  listGatewayEvents,
  getGatewayEvent,
};
