const Customer = require("../models/customers");
const { sendCommand } = require("../utils/mikrotikConnectionManager");
const { isYes, accountKeys } = require("./customerHelpers");

const CUSTOMER_PLAN_FIELDS = "name speed price duration";
const DISABLED_CUSTOMER_FIELDS = "accountNumber name phone email address plan connectionType accountAliases";

async function getCustomerHealth(tenantId, accountNumber) {
  const customer = await Customer.findOne({ tenantId, accountNumber })
    .populate("plan", CUSTOMER_PLAN_FIELDS)
    .lean();

  if (!customer) return null;

  const out = {
    ok: true,
    accountNumber,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    plan: customer.plan || null,
    connectionType: customer.connectionType,
    disabled: null,
    online: false,
    uptime: null,
    bytesIn: 0,
    bytesOut: 0,
    addressIp: null,
    deviceCount: null,
    status: customer.status || "active",
  };

  if (customer.connectionType === "pppoe") {
    let secret = [];
    let active = [];

    try {
      secret = await sendCommand("/ppp/secret/print", [`?name=${accountNumber}`], { tenantId, timeoutMs: 10000 });
    } catch (_) {}
    try {
      active = await sendCommand("/ppp/active/print", [`?name=${accountNumber}`], { tenantId, timeoutMs: 8000 });
    } catch (_) {}

    const secretRow = Array.isArray(secret) ? secret[0] : null;
    const activeRow = Array.isArray(active) ? active[0] : null;

    if (!secretRow) {
      out.disabled = null;
      out.status = customer.status || null;
    } else {
      const disabled = isYes(secretRow.disabled ?? secretRow["disabled"]);
      out.disabled = disabled;
      out.status = disabled ? "inactive" : "active";
    }

    out.online = !!activeRow;
    out.uptime = activeRow?.uptime || null;
    out.bytesIn = Number(activeRow?.["bytes-in"] || activeRow?.rx || 0) || 0;
    out.bytesOut = Number(activeRow?.["bytes-out"] || activeRow?.tx || 0) || 0;
    out.addressIp = activeRow?.address || activeRow?.["remote-address"] || null;
    out.deviceCount = out.online ? 1 : 0;
    return out;
  }

  if (customer.connectionType === "static") {
    const ip = customer?.staticConfig?.ip || null;
    let queues = [];
    let arp = [];

    try {
      queues = await sendCommand("/queue/simple/print", [`?name=${accountNumber}`], { tenantId, timeoutMs: 8000 });
    } catch (_) {}
    try {
      if (ip) arp = await sendCommand("/ip/arp/print", [`?address=${ip}`], { tenantId, timeoutMs: 6000 });
    } catch (_) {}

    const queueRow = Array.isArray(queues) ? queues[0] : null;
    const disabled = isYes(queueRow?.disabled ?? "no");
    const arpHit = Array.isArray(arp) && arp.length > 0;

    out.disabled = disabled;
    out.status = disabled ? "inactive" : "active";
    out.online = !!arpHit;
    out.deviceCount = arpHit ? 1 : 0;
  }

  return out;
}

async function listDisabledCustomers(tenantId) {
  let secrets = [];
  let queues = [];

  try {
    secrets = await sendCommand("/ppp/secret/print", [], { tenantId, timeoutMs: 12000 });
  } catch (_) {}
  try {
    queues = await sendCommand("/queue/simple/print", [], { tenantId, timeoutMs: 10000 });
  } catch (_) {}

  const pppoe = [];
  const staticQ = [];

  for (const secret of Array.isArray(secrets) ? secrets : []) {
    const name = secret?.name || secret?.user || secret?.username;
    if (!name) continue;
    if (isYes(secret?.disabled)) pppoe.push({ accountNumber: String(name), disabled: true });
  }

  for (const queue of Array.isArray(queues) ? queues : []) {
    const name = queue?.name;
    if (!name) continue;
    if (isYes(queue?.disabled)) staticQ.push({ accountNumber: String(name), disabled: true });
  }

  const allAccounts = [...pppoe, ...staticQ].map((item) => item.accountNumber);
  const customers = await Customer.find({
    tenantId,
    $or: [
      { accountNumber: { $in: allAccounts } },
      { accountAliases: { $in: allAccounts } },
    ],
  })
    .select(DISABLED_CUSTOMER_FIELDS)
    .populate("plan", "name speed price")
    .lean();

  const byKey = new Map();
  const register = (key, customer) => {
    const raw = String(key || "").trim();
    if (!raw) return;
    for (const variant of accountKeys(raw)) {
      if (!byKey.has(variant)) byKey.set(variant, customer);
    }
  };

  for (const customer of customers) {
    register(customer.accountNumber, customer);
    if (Array.isArray(customer.accountAliases)) {
      for (const alias of customer.accountAliases) register(alias, customer);
    }
  }

  const attach = (items) =>
    items.map((item) => {
      let customer = null;
      for (const key of accountKeys(item.accountNumber)) {
        customer = byKey.get(key);
        if (customer) break;
      }

      if (!customer) {
        const fallback = String(item.accountNumber || "").trim();
        if (fallback) customer = byKey.get(fallback);
      }

      return { ...item, customer: customer || null };
    });

  return {
    ok: true,
    pppoe: attach(pppoe),
    static: attach(staticQ),
  };
}

module.exports = {
  getCustomerHealth,
  listDisabledCustomers,
};
