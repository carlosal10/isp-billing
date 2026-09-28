'use strict';
const bcrypt = require('bcryptjs');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Membership = require('../models/Membership');
const Customer = require('../models/customers');
const Plan = require('../models/plan');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const { issueInvoiceForPlan } = require('../services/billingFinanceService');
async function seedTestData() {
  const tenants = await Tenant.create([{ name: 'Demo Fiber', subdomain: 'demo' }, { name: 'Other Fiber', subdomain: 'other' }]);
  const password = 'Demo-Only-2026!';
  const passwordHash = await bcrypt.hash(password, 10);
  const users = {};
  for (const role of ['owner', 'admin', 'operator']) {
    users[role] = await User.create({ email: `${role}@demo.example`, displayName: `Demo ${role}`, passwordHash, primaryTenant: tenants[0]._id });
    await Membership.create({ user: users[role]._id, tenant: tenants[0]._id, role });
  }
  const plans = [], customers = [], invoices = [], payments = [];
  for (const [index, tenant] of tenants.entries()) {
    const plan = await Plan.create({ tenantId: tenant._id, name: 'Home Fiber 20', description: 'Monthly home internet', price: 2500, duration: '30 days', speed: 20, rateLimit: '20M/20M' });
    const customer = await Customer.create({ tenantId: tenant._id, name: index ? 'Other Subscriber' : 'Amina Demo', accountNumber: 'DEMO-1001', email: `subscriber${index}@example.test`, phone: '+254700000001', connectionType: 'pppoe', plan: plan._id, portalProfile: { pinHash: await bcrypt.hash('654321', 10) } });
    const invoice = await issueInvoiceForPlan({ tenantId: tenant._id, customerId: customer._id, planId: plan._id });
    // Keep staging fixtures explicit: this exercises the same invoice shape as a real plan charge.
    invoice.lineItems = [{ description: 'Home Fiber 20 monthly service', kind: 'service', quantity: 1, unitPrice: 2500, amount: 2500 }];
    invoice.generated = true;
    invoice.status = 'issued';
    await invoice.save();
    const payment = await Payment.create({ tenantId: tenant._id, customer: customer._id, plan: plan._id, invoice: invoice._id, accountNumber: customer.accountNumber, amount: 2500, method: 'stripe', transactionId: `pi_demo_${index}` });
    plans.push(plan); customers.push(customer); invoices.push(invoice); payments.push(payment);
  }
  return { tenants, users, plans, customers, invoices, payments, password };
}
module.exports = { seedTestData };
