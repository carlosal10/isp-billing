const Customer = require("../models/customers");
const Tenant = require("../models/Tenant");
const Plan = require("../models/plan");
const AuditLog = require("../models/AuditLog");
const SmsSettings = require("../models/SmsSettings");
const SmsTemplate = require("../models/SmsTemplate");
const { sanitizeAliases } = require("./customerHelpers");
const { deriveAccountCode, deriveFullAddressCode } = require("../utils/accountNumber");
const {
  allocateFromPool,
  ensureCustomerIpAssignment,
  isValidIPv4,
  isIpInPool,
  releaseCustomerIpAssignment,
} = require("../utils/staticIpPool");
const { applyStaticFirewall } = require("../utils/staticSecurity");
const { sendCommand } = require("../utils/mikrotikConnectionManager");
const {
  applyCustomerQueue,
  removeCustomerQueue,
  updateCustomerQueue,
} = require("../utils/mikrotikBandwidthManager");
const { createPayLink } = require("../utils/paylink");
const { renderTemplate, formatDateISO } = require("../utils/template");
const { sendSms } = require("../utils/sms");
const { createProrationAdjustmentForPlanChange } = require("./billingFinanceService");

function serviceError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function randomAccountNumber() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from(
    { length: 10 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

async function generateAccountNumber({ tenantId, address, name, phone }) {
  try {
    const tenant = await Tenant.findById(tenantId).lean();
    const prefix = String(tenant?.accountPrefix || "").trim();
    const baseSource = address || name || phone || "CUST";
    const baseCode = prefix
      ? deriveAccountCode(baseSource)
      : deriveFullAddressCode(baseSource);

    let candidate = `${prefix}${baseCode}`;
    let attempt = 0;

    while (attempt < 5) {
      const exists = await Customer.findOne({
        tenantId,
        accountNumber: candidate,
      })
        .select("_id")
        .lean();
      if (!exists) return candidate;

      attempt += 1;
      const suffix = `-${attempt + 1}`;
      candidate = `${prefix}${baseCode}`.slice(0, Math.max(1, 16 - suffix.length)) + suffix;
    }

    return randomAccountNumber();
  } catch {
    return randomAccountNumber();
  }
}

async function maybeSendPaylinkSms({ tenantId, customer, plan, onPlanChange = false }) {
  const smsCfg = await SmsSettings.findOne({ tenantId }).lean();
  const shouldSend =
    smsCfg?.enabled &&
    (onPlanChange ? smsCfg?.autoSendOnPlanChange : smsCfg?.autoSendOnCreate);

  if (!shouldSend) return;

  const templateType = smsCfg?.autoTemplateType || "payment-link";
  const tmpl = await SmsTemplate.findOne({
    tenantId,
    type: templateType,
    active: true,
  }).lean();

  const body =
    tmpl?.body ||
    "Hi {{name}}, your {{plan_name}} (KES {{amount}}). Pay: {{payment_link}}";

  const dueAt = new Date(Date.now() + 3 * 24 * 3600 * 1000);
  const { url } = await createPayLink({
    tenantId,
    customerId: customer._id,
    planId: plan._id,
    dueAt,
  });

  const rendered = renderTemplate(body, {
    name: customer.name || "Customer",
    plan_name: plan.name || "Plan",
    amount: String(plan.price ?? ""),
    expiry_date: formatDateISO(dueAt),
    payment_link: url,
  });

  if (customer.phone) {
    await sendSms(tenantId, customer.phone, rendered);
  }
}

async function resolvePlan(tenantId, planId) {
  const plan = await Plan.findOne({ _id: planId, tenantId });
  if (!plan) throw serviceError(400, "Invalid plan selected");
  return plan;
}

async function prepareStaticIpForCreate(tenantId, staticConfig = {}) {
  const nextStaticConfig = { ...(staticConfig || {}) };
  let ipVal = nextStaticConfig.ip ? String(nextStaticConfig.ip).trim() : "";

  if (!ipVal) {
    ipVal = await allocateFromPool(tenantId);
    if (!ipVal) {
      throw serviceError(400, "No available static IP in tenant pool");
    }
    nextStaticConfig.ip = ipVal;
  }

  if (!isValidIPv4(ipVal)) {
    throw serviceError(400, "Invalid static IP address");
  }

  const inPool = await isIpInPool(tenantId, ipVal);
  if (!inPool) {
    throw serviceError(400, "static ip not within tenant pool");
  }

  const existingCustomerWithStaticIp = await Customer.findOne({ "staticConfig.ip": ipVal });
  if (existingCustomerWithStaticIp) {
    throw serviceError(400, "Static IP already used by another customer");
  }

  return nextStaticConfig;
}

async function createCustomer({
  tenantId,
  payload,
  requestMeta = {},
}) {
  const {
    name,
    email,
    phone,
    address,
    routerIp,
    plan: planId,
    connectionType,
    pppoeConfig,
    staticConfig,
    accountAliases,
    billingProfile,
  } = payload || {};

  const plan = await resolvePlan(tenantId, planId);

  let nextStaticConfig = staticConfig;
  if (connectionType === "pppoe") {
    if (!pppoeConfig?.profile) {
      throw serviceError(400, "PPPoE profile is required for PPPoE connections");
    }
  } else if (connectionType === "static") {
    nextStaticConfig = await prepareStaticIpForCreate(tenantId, staticConfig);
  } else {
    throw serviceError(400, "Invalid connection type");
  }

  const accountNumber = await generateAccountNumber({
    tenantId,
    address,
    name,
    phone,
  });

  const customer = new Customer({
    tenantId,
    name,
    email,
    phone,
    address,
    routerIp: routerIp || null,
    status: "active",
    accountNumber,
    plan: planId,
    connectionType,
    pppoeConfig:
      connectionType === "pppoe"
        ? {
            profile: pppoeConfig.profile,
            localAddress: pppoeConfig.localAddress || null,
            rateLimit: `${plan.speed}M/0M`,
          }
        : undefined,
    staticConfig: connectionType === "static" ? nextStaticConfig : undefined,
    accountAliases: sanitizeAliases(accountAliases, accountNumber),
    billingProfile: billingProfile || undefined,
  });

  const saved = await customer.save();

  if (connectionType === "pppoe") {
    const genPass = () => Math.random().toString(36).slice(-10);
    const secretPass = pppoeConfig?.password || genPass();
    try {
      await sendCommand(
        "/ppp/secret/add",
        [
          `=name=${accountNumber}`,
          `=password=${secretPass}`,
          `=profile=${pppoeConfig.profile}`,
          "=service=pppoe",
          `=comment=Customer: ${name || accountNumber}`,
        ],
        { tenantId, timeoutMs: 10000 }
      );
    } catch (e) {
      console.error("MikroTik add secret failed:", e?.message || e);
      await Customer.findByIdAndDelete(saved._id);
      throw serviceError(500, `Failed to create PPPoE secret: ${e?.message || e}`);
    }
  }

  try {
    await applyCustomerQueue(saved, plan);
  } catch (e) {
    console.warn("Queue apply failed:", e?.message || e);
  }

  if (connectionType === "static" && saved.staticConfig?.ip) {
    try {
      await ensureCustomerIpAssignment({
        tenantId,
        customerId: saved._id,
        ipAddress: saved.staticConfig.ip,
        note: "Static customer create",
      });
    } catch (assignmentError) {
      console.warn("Static IP assignment sync failed:", assignmentError?.message || assignmentError);
    }

    try {
      await AuditLog.create({
        userId: requestMeta.auth?.id || null,
        role: requestMeta.auth?.role || null,
        method: "ASSIGN_STATIC_IP",
        path: requestMeta.originalUrl,
        statusCode: 201,
        ip: saved.staticConfig.ip,
        userAgent: requestMeta.headers?.["user-agent"],
        payload: {
          action: "assign",
          staticIp: saved.staticConfig.ip,
          customerId: saved._id.toString(),
        },
      });
    } catch {}

    try {
      await applyStaticFirewall(tenantId, null, saved.staticConfig.ip);
    } catch {}
  }

  try {
    await maybeSendPaylinkSms({ tenantId, customer: saved, plan });
  } catch (e) {
    console.warn("Auto-send paylink SMS failed:", e?.message || e);
  }

  return saved;
}

function buildAllowedUpdateFields(payload) {
  const {
    name,
    email,
    phone,
    address,
    status,
    plan,
    connectionType,
    pppoeConfig,
    staticConfig,
    accountNumber,
    accountAliases,
    billingProfile,
  } = payload || {};

  const allowed = {
    name,
    email,
    phone,
    address,
    status,
    plan,
    connectionType,
    pppoeConfig,
    staticConfig,
    accountNumber,
    accountAliases,
    billingProfile,
  };

  Object.keys(allowed).forEach((key) => {
    if (allowed[key] === undefined) delete allowed[key];
  });

  return allowed;
}

function shouldReleasePreviousStaticIp(customer, requestedConnectionType, requestedIp) {
  if (!customer || customer.connectionType !== "static") return false;

  const newConnectionType = requestedConnectionType || customer.connectionType;
  const nextIp = requestedIp ? String(requestedIp).trim() : null;
  const changingToNonStatic = newConnectionType !== "static";
  const changingIp = nextIp && nextIp !== customer.staticConfig?.ip;

  return Boolean(changingToNonStatic || changingIp);
}

async function renameRouterArtifactsIfNeeded({
  tenantId,
  previousAccount,
  nextAccount,
  nextName,
}) {
  if (!previousAccount || !nextAccount || previousAccount === nextAccount) return;

  try {
    const list = await sendCommand("/ppp/secret/print", [`?name=${previousAccount}`], {
      tenantId,
      timeoutMs: 10000,
    });
    if (Array.isArray(list) && list[0]) {
      const id = list[0][".id"] || list[0].id || list[0].numbers;
      await sendCommand(
        "/ppp/secret/set",
        [
          `=numbers=${id}`,
          `=name=${nextAccount}`,
          `=comment=Customer: ${nextName}`,
        ],
        { tenantId, timeoutMs: 10000 }
      );
    }
  } catch (e) {
    console.warn("PPP secret rename failed:", e?.message || e);
  }

  try {
    const q = await sendCommand("/queue/simple/print", [`?name=${previousAccount}`], {
      tenantId,
      timeoutMs: 8000,
    });
    if (Array.isArray(q) && q[0]) {
      const qid = q[0][".id"] || q[0].id || q[0].numbers;
      await sendCommand(
        "/queue/simple/set",
        [
          `=numbers=${qid}`,
          `=name=${nextAccount}`,
          `=comment=Customer: ${nextName}`,
        ],
        { tenantId, timeoutMs: 8000 }
      );
    }
  } catch (e) {
    console.warn("Queue rename failed:", e?.message || e);
  }
}

async function updatePppoeSecret({
  tenantId,
  customer,
  allowed,
  nextAccount,
  nextName,
}) {
  const searchKeys = [];
  const pushKey = (value) => {
    const v = String(value || "").trim();
    if (!v) return;
    if (!searchKeys.includes(v)) searchKeys.push(v);
  };

  pushKey(nextAccount);
  pushKey(customer.accountNumber);
  if (Array.isArray(customer.accountAliases)) {
    for (const alias of customer.accountAliases) pushKey(alias);
  }
  if (Array.isArray(allowed.accountAliases)) {
    for (const alias of allowed.accountAliases) pushKey(alias);
  }

  let secret = null;
  for (const key of searchKeys) {
    const list = await sendCommand("/ppp/secret/print", [`?name=${key}`], {
      tenantId,
      timeoutMs: 10000,
    });
    if (Array.isArray(list) && list[0]) {
      secret = list[0];
      break;
    }
  }

  if (!secret) {
    throw serviceError(404, "PPPoE secret not found on MikroTik for this account");
  }

  const id = secret[".id"] || secret.id || secret.numbers;
  const existingName = secret.name || secret.user || secret.username || null;
  const commands = [
    `=numbers=${id}`,
    `=profile=${allowed.pppoeConfig.profile}`,
    `=comment=Customer: ${nextName}`,
  ];

  if (existingName && existingName !== nextAccount) {
    commands.push(`=name=${nextAccount}`);
  }

  try {
    await sendCommand("/ppp/secret/set", commands, { tenantId, timeoutMs: 10000 });
  } catch (e) {
    throw serviceError(500, `Failed to update PPPoE secret: ${e?.message || e}`);
  }
}

async function prepareStaticIpForUpdate({
  tenantId,
  customer,
  allowed,
  prevStaticIp,
}) {
  const nextStaticConfig = {
    ...(customer.staticConfig || {}),
    ...(allowed.staticConfig || {}),
  };
  let newIp = nextStaticConfig.ip ? String(nextStaticConfig.ip).trim() : "";

  if (!newIp) {
    if (prevStaticIp) {
      newIp = prevStaticIp;
    } else {
      newIp = await allocateFromPool(tenantId);
      if (!newIp) {
        throw serviceError(400, "No available static IP in tenant pool");
      }
    }
    nextStaticConfig.ip = newIp;
  }

  if (!isValidIPv4(newIp)) {
    throw serviceError(400, "Invalid static IP address");
  }

  if (!prevStaticIp || newIp !== prevStaticIp) {
    const exists = await Customer.findOne({
      "staticConfig.ip": newIp,
      _id: { $ne: customer._id },
    }).lean();
    if (exists) {
      throw serviceError(400, "Static IP already assigned to another customer");
    }
  }

  const inPool = await isIpInPool(tenantId, newIp);
  if (!inPool) {
    throw serviceError(400, "Static IP is not within the tenant's pool");
  }

  return nextStaticConfig;
}

async function updateCustomer({
  tenantId,
  customerId,
  payload,
}) {
  const customer = await Customer.findOne({ _id: customerId, tenantId });
  if (!customer) throw serviceError(404, "Customer not found");

  if (
    payload?.connectionType !== undefined &&
    payload.connectionType !== "pppoe" &&
    payload.connectionType !== "static"
  ) {
    throw serviceError(400, "Invalid connection type");
  }

  const releasePreviousStaticIp = shouldReleasePreviousStaticIp(
    customer,
    payload?.connectionType,
    payload?.staticConfig?.ip
  );

  const originalPlanId = customer.plan ? String(customer.plan) : "";
  const prevStaticIp = customer?.staticConfig?.ip
    ? String(customer.staticConfig.ip).trim()
    : null;
  const allowed = buildAllowedUpdateFields(payload);
  const selectedPlanId = allowed.plan || customer.plan;
  const plan = await resolvePlan(tenantId, selectedPlanId);

  const previousAccount = String(customer.accountNumber || "").trim();
  const nextAccount = String(allowed.accountNumber || previousAccount).trim();
  const nextName = String(allowed.name ?? customer.name ?? nextAccount);
  const nextConnectionType = allowed.connectionType || customer.connectionType;

  await renameRouterArtifactsIfNeeded({
    tenantId,
    previousAccount,
    nextAccount,
    nextName,
  });

  const manualAliases =
    allowed.accountAliases !== undefined
      ? sanitizeAliases(allowed.accountAliases, nextAccount)
      : null;

  if (previousAccount && previousAccount !== nextAccount) {
    const baseAliases =
      manualAliases !== null
        ? manualAliases
        : sanitizeAliases(customer.accountAliases, nextAccount);
    const aliasSet = new Set(baseAliases);
    aliasSet.add(previousAccount);
    customer.accountAliases = Array.from(aliasSet).slice(0, 10);
  } else if (manualAliases !== null) {
    customer.accountAliases = manualAliases;
  }

  if (nextConnectionType === "pppoe") {
    const nextPppoeConfig = {
      ...(customer.pppoeConfig || {}),
      ...(allowed.pppoeConfig || {}),
    };

    if (!nextPppoeConfig?.profile) {
      throw serviceError(400, "PPPoE profile required");
    }

    customer.staticConfig = undefined;
    customer.pppoeConfig = {
      profile: nextPppoeConfig.profile,
      localAddress: nextPppoeConfig.localAddress || null,
      rateLimit: `${plan.speed}M/0M`,
    };

    await updatePppoeSecret({
      tenantId,
      customer,
      allowed: {
        ...allowed,
        pppoeConfig: nextPppoeConfig,
      },
      nextAccount,
      nextName,
    });
  } else if (nextConnectionType === "static") {
    customer.pppoeConfig = undefined;
    customer.staticConfig = await prepareStaticIpForUpdate({
      tenantId,
      customer,
      allowed,
      prevStaticIp,
    });
  }

  customer.connectionType = nextConnectionType;
  customer.name = nextName;
  customer.email = allowed.email ?? customer.email;
  customer.phone = allowed.phone ?? customer.phone;
  customer.address = allowed.address ?? customer.address;
  customer.status = allowed.status ?? customer.status;
  customer.plan = selectedPlanId;
  customer.accountNumber = nextAccount;
  if (allowed.billingProfile !== undefined) {
    customer.billingProfile = {
      ...(customer.billingProfile || {}),
      ...(allowed.billingProfile || {}),
    };
  }

  const updated = await customer.save();

  if (releasePreviousStaticIp && prevStaticIp) {
    try {
      await releaseCustomerIpAssignment({
        tenantId,
        customerId: updated._id,
        ipAddress: prevStaticIp,
        reason: "Static IP changed on customer update",
      });
    } catch (releaseErr) {
      console.warn("Static IP release sync failed:", releaseErr?.message || releaseErr);
    }
  }

  if (updated.connectionType === "static" && updated.staticConfig?.ip) {
    try {
      await ensureCustomerIpAssignment({
        tenantId,
        customerId: updated._id,
        ipAddress: updated.staticConfig.ip,
        note: "Static customer update",
      });
    } catch (assignmentErr) {
      console.warn("Static IP assignment update sync failed:", assignmentErr?.message || assignmentErr);
    }
  }

  try {
    await updateCustomerQueue(updated, plan);
  } catch (e) {
    console.warn("Queue update failed:", e?.message || e);
  }

  try {
    const newPlanId = updated.plan ? String(updated.plan) : "";
    const planChanged = newPlanId && newPlanId !== originalPlanId;
    if (planChanged) {
      try {
        await createProrationAdjustmentForPlanChange({
          tenantId,
          customerId: updated._id,
          oldPlanId: originalPlanId || null,
          newPlanId: updated.plan,
          currentExpiryDate: updated.expiryDate || null,
        });
      } catch (financeErr) {
        console.warn("Proration adjustment failed:", financeErr?.message || financeErr);
      }
      await maybeSendPaylinkSms({
        tenantId,
        customer: updated,
        plan,
        onPlanChange: true,
      });
    }
  } catch (e) {
    console.warn("Auto-send on plan change failed:", e?.message || e);
  }

  return updated;
}

async function deleteCustomer({
  tenantId,
  customerId,
}) {
  const customer = await Customer.findOneAndDelete({ _id: customerId, tenantId });
  if (!customer) throw serviceError(404, "Customer not found");

  if (customer.connectionType === "static") {
    await releaseCustomerIpAssignment({
      tenantId,
      customerId: customer._id,
      ipAddress: customer.staticConfig?.ip || null,
      reason: "Customer deleted",
    }).catch((err) => {
      console.warn("Static IP release after customer delete failed:", err?.message || err);
    });
  }

  if (customer.connectionType === "pppoe") {
    try {
      const list = await sendCommand("/ppp/secret/print", [`?name=${customer.accountNumber}`], {
        tenantId,
        timeoutMs: 10000,
      });
      if (Array.isArray(list) && list[0]) {
        const id = list[0][".id"] || list[0].id || list[0].numbers;
        await sendCommand("/ppp/secret/remove", [`=numbers=${id}`], {
          tenantId,
          timeoutMs: 10000,
        });
      }
    } catch (e) {
      console.warn("PPPoE secret remove failed:", e?.message || e);
    }
  }

  try {
    await removeCustomerQueue(customer);
  } catch (e) {
    console.warn("Queue remove failed:", e?.message || e);
  }

  return customer;
}

module.exports = {
  createCustomer,
  updateCustomer,
  deleteCustomer,
};
