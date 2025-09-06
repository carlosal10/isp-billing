const jwt = require('jsonwebtoken');
const Plan = require('../models/plan');
const Customer = require('../models/customers');

const TOKEN_TTL_DAYS = 14; // default lifetime for link tokens

function buildBaseUrl() {
  // Prefer an explicit public base URL; else fall back to CLIENT_URL; else derive
  return (
    process.env.PUBLIC_BASE_URL ||
    process.env.CLIENT_URL ||
    ''
  );
}

function signPayToken(payload, { expiresIn = `${TOKEN_TTL_DAYS}d` } = {}) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('Missing JWT_SECRET');
  return jwt.sign(payload, secret, { expiresIn });
}

function verifyPayToken(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('Missing JWT_SECRET');
  return jwt.verify(token, secret);
}

async function createPayLink({ tenantId, customerId, planId, dueAt }) {
  const token = signPayToken({ tenantId, customerId, planId, dueAt });
  const base = buildBaseUrl();
  const url = base ? `${base}/pay?token=${encodeURIComponent(token)}` : `/pay?token=${encodeURIComponent(token)}`;
  return { token, url };
}

async function getPayInfo({ token }) {
  const decoded = verifyPayToken(token);
  const { tenantId, customerId, planId, dueAt } = decoded;

  const [customer, currentPlan, otherPlans] = await Promise.all([
    Customer.findOne({ _id: customerId, tenantId }).lean(),
    Plan.findOne({ _id: planId, tenantId }).lean(),
    Plan.find({ tenantId }).select('name description price duration').lean(),
  ]);

  if (!customer || !currentPlan) throw new Error('Invalid or outdated link');

  return {
    tenantId: String(tenantId),
    customer: { _id: customer._id, name: customer.name, phone: customer.phone, accountNumber: customer.accountNumber },
    plan: { _id: currentPlan._id, name: currentPlan.name, description: currentPlan.description, price: currentPlan.price, duration: currentPlan.duration },
    otherPlans,
    dueAt,
  };
}

module.exports = { createPayLink, getPayInfo, verifyPayToken };

