'use strict';

const Payment = require('../models/Payment');
const Customer = require('../models/customers');
const Plan = require('../models/plan');
const {
  applyCustomerQueue,
  enableCustomerQueue,
  disableCustomerQueue,
  enablePppoeSecret,
  disablePppoeSecret,
} = require('../utils/mikrotikBandwidthManager');
const { resolvePlanDurationDays } = require('./paymentEntitlementService');

async function resolvePlan(customer) {
  if (!customer?.plan) return null;
  if (typeof customer.plan === 'object' && customer.plan._id) return customer.plan;
  return Plan.findById(customer.plan).lean().catch(() => null);
}

async function restoreCustomerAccess({ customer, plan, debugId }) {
  const managed = await require('./subscriberAccessService').synchronizeBilling(customer, true);
  if (managed.managed) return managed;
  const blocked = await require('../models/NetworkAssignment').exists({ tenantId: customer.tenantId, customerId: customer._id, status: { $ne: 'released' }, 'fup.desired': 'blocked' });
  if (blocked) { await suspendCustomerAccess({ customer, debugId }); return; }
  const tenantId = String(customer?.tenantId || '');
  const context = {
    tenantId,
    account: customer?.accountNumber || null,
    connectionType: customer?.connectionType || 'unknown',
  };

  if (customer?.connectionType === 'static') {
    await enableCustomerQueue(customer, plan);
    console.log(`[${debugId}] customer access restored`, { ...context, action: 'enable-static' });
    return;
  }

  if (customer?.connectionType === 'pppoe') {
    await enablePppoeSecret(customer);
    await applyCustomerQueue(customer, plan);
    console.log(`[${debugId}] customer access restored`, { ...context, action: 'enable-pppoe' });
    return;
  }

  await applyCustomerQueue(customer, plan);
  console.log(`[${debugId}] customer access restored`, { ...context, action: 'apply-generic' });
}

async function suspendCustomerAccess({ customer, debugId }) {
  const managed = await require('./subscriberAccessService').synchronizeBilling(customer, false);
  if (managed.managed) return managed;
  const tenantId = String(customer?.tenantId || '');
  const context = {
    tenantId,
    account: customer?.accountNumber || null,
    connectionType: customer?.connectionType || 'unknown',
  };

  if (customer?.connectionType === 'static') {
    await disableCustomerQueue(customer);
    console.log(`[${debugId}] customer access suspended`, { ...context, action: 'disable-static' });
    return;
  }

  if (customer?.connectionType === 'pppoe') {
    await disablePppoeSecret(customer);
    console.log(`[${debugId}] customer access suspended`, { ...context, action: 'disable-pppoe' });
    return;
  }

  await disableCustomerQueue(customer);
  console.log(`[${debugId}] customer access suspended`, { ...context, action: 'disable-generic' });
}

async function syncCustomerNetworkState({ customer, debugId }) {
  if (!customer) return null;
  const plan = await resolvePlan(customer);
  const now = Date.now();
  const expiryMs = customer.expiryDate ? new Date(customer.expiryDate).getTime() : null;
  const active = customer.status === 'active' && expiryMs && expiryMs > now;

  if (active) {
    await restoreCustomerAccess({ customer, plan, debugId });
  } else {
    await suspendCustomerAccess({ customer, debugId });
  }

  return {
    customerId: String(customer._id),
    status: customer.status,
    expiryDate: customer.expiryDate || null,
    active,
  };
}

async function syncCustomerAccessFromPayments({ tenantId, customerId, debugId = `pay-sync-${Date.now()}` }) {
  const customer = await require('./financialTransaction').financialTransaction(async () => {
    const customer = await Customer.findOneAndUpdate({ _id: customerId, tenantId }, { $inc: { __v: 1 } }, { new: true }).populate('plan');
    if (!customer) return null;
    if (customer.status === 'archived') return customer;

    const payments = await Payment.find({
      tenantId,
      customer: customerId,
      isDeleted: { $ne: true },
      status: { $in: ['Success', 'Validated'] },
      isFinanciallyApplied: true,
    })
      .populate('plan', 'duration durationDays')
      .lean();

    let maxExpiry = null;
    const now = Date.now();

    for (const payment of payments) {
      const durationDays = resolvePlanDurationDays(payment?.plan);
      if (!Number.isFinite(durationDays) || durationDays <= 0) continue;

      const baseStart = payment.validatedAt || payment.createdAt;
      const computedExpiry = payment.expiryDate
        ? new Date(payment.expiryDate).getTime()
        : baseStart
        ? new Date(baseStart).getTime() + durationDays * 86400000
        : null;

      if (!computedExpiry) continue;
      if (maxExpiry == null || computedExpiry > maxExpiry) maxExpiry = computedExpiry;
    }

    if (maxExpiry && maxExpiry > now) {
      customer.status = 'active';
      customer.expiryDate = new Date(maxExpiry);
    } else {
      customer.status = 'inactive';
      if (maxExpiry) customer.expiryDate = new Date(maxExpiry);
      else customer.expiryDate = undefined;
    }

    await customer.save();
    return customer;
  });
  if (!customer) return null;
  if (customer.status === 'archived') return { customerId: String(customer._id), active: false, archived: true };
  return syncCustomerNetworkState({ customer, debugId });
}

module.exports = {
  restoreCustomerAccess,
  suspendCustomerAccess,
  syncCustomerNetworkState,
  syncCustomerAccessFromPayments,
};
