const Payment = require("../models/Payment");
const Customer = require("../models/customers");
const Plan = require("../models/plan");
const {
  resolvePlanDurationDays,
  computeExpiryDate,
  resolveEntitlementAnchor,
} = require("./paymentEntitlementService");
const {
  syncCustomerAccessFromPayments,
  syncCustomerNetworkState,
} = require("./customerAccessService");
const { syncPaymentFinancials } = require("./billingFinanceService");

function serviceError(statusCode, message, extras = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  Object.assign(err, extras);
  return err;
}

function safeNumber(value) {
  if (value === "" || value === null || value === undefined) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

function diffAllowedFields(prev, next) {
  const changes = {};
  for (const key of ["transactionId", "amount", "method", "notes", "status", "expiryDate"]) {
    const before = prev[key];
    const after = next[key];
    const A = before instanceof Date ? before.toISOString() : before ?? "";
    const B = after instanceof Date ? after.toISOString() : after ?? "";
    if (B !== A) changes[key] = { from: before, to: after };
  }
  return changes;
}

async function manualValidatePayment({ tenantId, payload }) {
  const debugId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const {
    paymentId,
    customerId,
    accountNumber,
    transactionId,
    amount,
    method,
    notes,
    validatedBy,
    paidAt,
    backdateTo,
    expiryDate,
    extendDays,
  } = payload || {};

  if (!transactionId || !String(transactionId).trim()) {
    throw serviceError(400, "transactionId is required", { debugId });
  }

  if (paymentId) {
    const payment = await Payment.findOne({ _id: paymentId, tenantId }).populate("customer plan");
    if (!payment) throw serviceError(404, "Payment not found", { debugId });
    if (payment.isDeleted) throw serviceError(400, "Cannot validate a deleted payment", { debugId });
    if (!payment.plan) throw serviceError(400, "Payment has no plan associated", { debugId });

    const durationDays = resolvePlanDurationDays(payment.plan);
    if (!Number.isFinite(durationDays) || durationDays <= 0) {
      throw serviceError(400, "Invalid plan duration on payment.plan", { debugId });
    }

    payment.transactionId = String(transactionId).trim();
    payment.status = "Success";
    payment.validatedBy = validatedBy || "Manual Entry";
    payment.validatedAt = paidAt ? new Date(paidAt) : new Date();
    if (notes) payment.notes = notes;
    const computedExpiry = computeExpiryDate({
      plan: payment.plan,
      customerExpiryDate: payment.customer?.expiryDate || null,
      referenceDate: payment.validatedAt,
      overrideAnchorDate: backdateTo || null,
      expiryDate: expiryDate || null,
      extendDays,
    });
    if (!computedExpiry) {
      throw serviceError(400, "Could not compute expiry date", { debugId });
    }
    payment.expiryDate = computedExpiry;

    try {
      await payment.save();
    } catch (e) {
      if (e?.code === 11000 && e?.keyPattern?.transactionId) {
        throw serviceError(409, "Duplicate transactionId for this tenant", { debugId });
      }
      throw e;
    }
    await syncPaymentFinancials({
      paymentId: payment._id,
      actor: { id: validatedBy || "Manual Entry" },
      reason: "Manual payment validation",
    }).catch((e) => {
      console.warn(`[${debugId}] finance sync failed:`, e?.message || e);
    });

    await syncCustomerAccessFromPayments({
      tenantId,
      customerId: payment.customer?._id || payment.customer,
      debugId,
    }).catch((e) => {
      console.warn(`[${debugId}] customer access sync failed:`, e?.message || e);
    });

    return { message: "Payment validated", payment, debugId };
  }

  let customer = null;
  if (customerId) {
    customer = await Customer.findOne({ _id: customerId, tenantId }).populate("plan");
  } else if (accountNumber) {
    customer = await Customer.findOne({ accountNumber, tenantId }).populate("plan");
  } else {
    throw serviceError(400, "Provide customerId or accountNumber", { debugId });
  }

  if (!customer) throw serviceError(404, "Customer not found", { debugId });
  if (!customer.plan) throw serviceError(400, "Customer has no plan assigned", { debugId });

  const plan = (await Plan.findOne({ _id: customer.plan._id, tenantId })) || customer.plan;
  const priceNum = amount !== undefined && amount !== "" ? safeNumber(amount) : safeNumber(plan.price);
  if (!Number.isFinite(priceNum) || priceNum < 0) {
    throw serviceError(400, "Invalid amount (must be a number ≥ 0)", { debugId });
  }

  const durationDays = resolvePlanDurationDays(plan);
  if (!Number.isFinite(durationDays) || durationDays <= 0) {
    throw serviceError(400, "Invalid plan.duration (must be days > 0)", { debugId });
  }

  const validatedAt = paidAt ? new Date(paidAt) : new Date();
  const computedExpiry = computeExpiryDate({
    plan,
    customerExpiryDate: customer.expiryDate || null,
    referenceDate: validatedAt,
    overrideAnchorDate: backdateTo || null,
    expiryDate: expiryDate || null,
    extendDays,
  });
  if (!computedExpiry) {
    throw serviceError(400, "Could not compute expiry date", { debugId });
  }

  const doc = new Payment({
    tenantId,
    accountNumber: customer.accountNumber,
    phoneNumber: customer.phone || undefined,
    customer: customer._id,
    plan: plan._id,
    amount: priceNum,
    method: method || "manual",
    status: "Success",
    transactionId: String(transactionId).trim(),
    validatedBy: validatedBy || "Manual Entry",
    validatedAt,
    expiryDate: computedExpiry,
    ...(notes ? { notes } : {}),
  });

  try {
    await doc.save();
  } catch (e) {
    if (e?.code === 11000 && e?.keyPattern?.transactionId) {
      throw serviceError(409, "Duplicate transactionId for this tenant", { debugId });
    }
    throw e;
  }
  await syncPaymentFinancials({
    paymentId: doc._id,
    actor: { id: validatedBy || "Manual Entry" },
    reason: "Manual payment creation",
  }).catch((e) => {
    console.warn(`[${debugId}] finance sync failed:`, e?.message || e);
  });

  await syncCustomerAccessFromPayments({
    tenantId,
    customerId: customer._id,
    debugId,
  }).catch((e) => {
    console.warn(`[${debugId}] customer access sync failed:`, e?.message || e);
  });

  return { message: "Manual payment created and validated", payment: doc, debugId };
}

async function adjustPayment({ tenantId, payload }) {
  const debugId = `adjust-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const {
    customerId,
    accountNumber,
    backdateTo,
    extendDays,
    notes,
    validatedBy,
  } = payload || {};

  if (!customerId && !accountNumber) {
    throw serviceError(400, "Provide customerId or accountNumber", { debugId });
  }

  const backdateStr = backdateTo ? String(backdateTo).trim() : "";
  const extendProvided =
    extendDays !== undefined && extendDays !== null && String(extendDays).trim() !== "";
  const extendValue = extendProvided ? Number(extendDays) : 0;

  if (extendProvided && !Number.isFinite(extendValue)) {
    throw serviceError(400, "extendDays must be a number", { debugId });
  }
  if (!backdateStr && !extendProvided) {
    throw serviceError(400, "Provide backdateTo or extendDays", { debugId });
  }

  let backdateDate = null;
  if (backdateStr) {
    backdateDate = new Date(backdateStr);
    if (Number.isNaN(backdateDate.getTime())) {
      throw serviceError(400, "Invalid backdateTo", { debugId });
    }
  }

  const notesTrim = notes ? String(notes).trim() : "";
  const customer = customerId
    ? await Customer.findOne({ _id: customerId, tenantId }).populate("plan")
    : await Customer.findOne({ accountNumber, tenantId }).populate("plan");

  if (!customer) throw serviceError(404, "Customer not found", { debugId });
  if (!customer.plan) throw serviceError(400, "Customer has no plan assigned", { debugId });

  const plan = (await Plan.findOne({ _id: customer.plan._id, tenantId })) || customer.plan;
  const durationDays = resolvePlanDurationDays(plan);
  if (!Number.isFinite(durationDays) || durationDays <= 0) {
    throw serviceError(400, "Invalid plan duration", { debugId });
  }

  let computedExpiry = null;
  if (backdateDate) {
    computedExpiry = computeExpiryDate({
      plan,
      customerExpiryDate: customer.expiryDate || null,
      referenceDate: new Date(),
      overrideAnchorDate: backdateDate,
    });
  } else {
    const anchor = resolveEntitlementAnchor({
      customerExpiryDate: customer.expiryDate || null,
      referenceDate: new Date(),
    });
    computedExpiry = new Date(anchor);
  }
  if (!computedExpiry) throw serviceError(400, "Could not compute expiry date", { debugId });
  if (extendValue) {
    computedExpiry = new Date(computedExpiry.getTime() + Math.round(extendValue) * 86400000);
  }

  const now = Date.now();
  customer.expiryDate = computedExpiry;
  customer.status = computedExpiry.getTime() > now ? "active" : "inactive";
  await customer.save().catch((err) => {
    console.warn(`[${debugId}] customer save failed:`, err?.message || err);
  });

  const payment = await Payment.findOne({
    tenantId,
    customer: customer._id,
    isDeleted: { $ne: true },
    status: { $in: ["Success", "Validated"] },
  }).sort({ validatedAt: -1, createdAt: -1 });

  if (payment) {
    const before = payment.toObject();
    payment.expiryDate = computedExpiry;
    if (backdateDate) payment.validatedAt = backdateDate;
    if (notesTrim) {
      const existing = payment.notes ? `${payment.notes} | ` : "";
      payment.notes = existing + notesTrim;
    }
    payment.editedAt = new Date();
    payment.editedBy = validatedBy || "Adjustment";

    const changes = diffAllowedFields(before, payment.toObject());
    if (Object.keys(changes).length) {
      payment.editLog = payment.editLog || [];
      payment.editLog.push({ at: new Date(), by: payment.editedBy, changes });
    }

    try {
      await payment.save();
    } catch (saveErr) {
      console.error(`[${debugId}] payment adjustment save failed:`, saveErr?.message || saveErr);
    }
  } else {
    console.log("[payments:/adjust] no prior payment found", {
      tenantId: String(tenantId),
      customerId: String(customer._id),
    });
  }

  await syncCustomerNetworkState({ customer, debugId }).catch((queueErr) => {
    console.warn(`[${debugId}] customer access sync failed:`, queueErr?.message || queueErr);
  });

  console.log("[payments:/adjust] applied", {
    tenantId: String(tenantId),
    customerId: String(customer._id),
    backdateTo: backdateDate || null,
    extendDays: extendProvided ? extendValue : null,
    expiry: computedExpiry,
  });

  return {
    message: "Adjustment applied",
    debugId,
    expiryDate: computedExpiry,
  };
}

async function updatePaymentRecord({ tenantId, paymentId, payload }) {
  const {
    transactionId,
    amount,
    method,
    notes,
    status,
    expiryDate,
    editedBy,
    validatedAt,
    backdateTo,
    extendDays,
  } = payload || {};

  const payment = await Payment.findOne({ _id: paymentId, tenantId }).populate("plan");
  if (!payment) throw serviceError(404, "Payment not found");
  if (payment.isDeleted) throw serviceError(400, "Cannot edit a deleted payment");

  const before = payment.toObject();

  if (transactionId !== undefined) payment.transactionId = String(transactionId).trim();
  if (amount !== undefined) {
    if (amount !== "") {
      const num = safeNumber(amount);
      if (!Number.isFinite(num) || num < 0) throw serviceError(400, "Invalid amount");
      payment.amount = num;
    }
  }
  if (method !== undefined) payment.method = String(method).trim() || payment.method;
  if (notes !== undefined) payment.notes = String(notes);
  if (status !== undefined) payment.status = String(status);
  if (expiryDate !== undefined) {
    const d = expiryDate ? new Date(expiryDate) : null;
    if (d && Number.isNaN(d.getTime())) throw serviceError(400, "Invalid expiryDate");
    payment.expiryDate = d || payment.expiryDate;
  }
  if (validatedAt !== undefined) {
    const d = validatedAt ? new Date(validatedAt) : null;
    if (d && Number.isNaN(d.getTime())) throw serviceError(400, "Invalid validatedAt");
    if (d) payment.validatedAt = d;
  }
  if (backdateTo !== undefined) {
    const d = backdateTo ? new Date(backdateTo) : null;
    if (d && Number.isNaN(d.getTime())) throw serviceError(400, "Invalid backdateTo");
      const days = resolvePlanDurationDays(payment.plan);
    if (d && Number.isFinite(days) && days > 0) {
      payment.expiryDate = new Date(d.getTime() + days * 86400000);
    }
  }
  if (extendDays !== undefined) {
    const n = Number(extendDays);
    if (!Number.isNaN(n)) {
      const base = payment.expiryDate?.getTime() || Date.now();
      payment.expiryDate = new Date(base + Math.round(n) * 86400000);
    }
  }

  payment.editedAt = new Date();
  payment.editedBy = editedBy || "Admin Panel";

  const changes = diffAllowedFields(before, payment.toObject());
  if (Object.keys(changes).length) {
    payment.editLog = payment.editLog || [];
    payment.editLog.push({ at: new Date(), by: payment.editedBy, changes });
  }

  try {
    await payment.save();
  } catch (e) {
    if (e?.code === 11000 && e?.keyPattern?.transactionId) {
      throw serviceError(409, "Duplicate transactionId for this tenant");
    }
    throw e;
  }

  const impactful = ["amount", "status", "transactionId", "method", "expiryDate"].some(
    (key) => changes[key]
  );
  if (impactful && payment.customer) {
    await syncPaymentFinancials({
      paymentId: payment._id,
      actor: { id: editedBy || "Admin Panel" },
      reason: "Payment record updated",
    }).catch((err) => {
      console.warn(`[payments:update] finance sync failed:`, err?.message || err);
    });
    await syncCustomerAccessFromPayments({
      tenantId,
      customerId: payment.customer,
      debugId: `update-${Date.now()}`,
    });
  }

  return { ok: true, payment };
}

async function softDeletePayment({ tenantId, paymentId, payload }) {
  const { reason, deletedBy } = payload || {};
  const payment = await Payment.findOne({ _id: paymentId, tenantId });
  if (!payment) throw serviceError(404, "Payment not found");
  if (payment.isDeleted) return { ok: true, message: "Already deleted" };

  payment.isDeleted = true;
  payment.deletedAt = new Date();
  payment.deletedBy = deletedBy || "Admin Panel";
  payment.deleteReason = reason || "Removed via UI";

  await payment.save();
  await syncPaymentFinancials({
    paymentId: payment._id,
    actor: { id: deletedBy || "Admin Panel" },
    reason: reason || "Payment deleted",
  }).catch((err) => {
    console.warn(`[payments:delete] finance sync failed:`, err?.message || err);
  });
  if (payment.customer) {
    await syncCustomerAccessFromPayments({
      tenantId,
      customerId: payment.customer,
      debugId: `delete-${Date.now()}`,
    });
  }

  return { ok: true, message: "Payment deleted" };
}

async function restorePaymentRecord({ tenantId, paymentId }) {
  const payment = await Payment.findOne({ _id: paymentId, tenantId });
  if (!payment) throw serviceError(404, "Payment not found");
  if (!payment.isDeleted) return { ok: true, message: "Payment is not deleted" };

  payment.isDeleted = false;
  payment.deletedAt = undefined;
  payment.deletedBy = undefined;
  payment.deleteReason = undefined;

  await payment.save();
  await syncPaymentFinancials({
    paymentId: payment._id,
    actor: { id: "Admin Panel" },
    reason: "Payment restored",
  }).catch((err) => {
    console.warn(`[payments:restore] finance sync failed:`, err?.message || err);
  });
  if (payment.customer) {
    await syncCustomerAccessFromPayments({
      tenantId,
      customerId: payment.customer,
      debugId: `restore-${Date.now()}`,
    });
  }

  return { ok: true, message: "Payment restored", payment };
}

module.exports = {
  manualValidatePayment,
  adjustPayment,
  updatePaymentRecord,
  softDeletePayment,
  restorePaymentRecord,
};
