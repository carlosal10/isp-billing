const Customer = require("../models/customers");
const { qs, w } = require("./mikrotikSupport");
const { sendCommand } = require("../utils/mikrotikConnectionManager");
const { disableCustomerQueue, enableCustomerQueue } = require("../utils/mikrotikBandwidthManager");

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getRouterObjectId(row) {
  return row?.[".id"] || row?.id || row?.numbers || null;
}

async function getAccountSearchKeys(tenantId, rawName) {
  const searchKeys = new Set([rawName]);

  try {
    const customer = await Customer.findOne({
      tenantId,
      $or: [{ accountNumber: rawName }, { accountAliases: rawName }],
    }).lean();

    if (customer?.accountNumber) searchKeys.add(String(customer.accountNumber).trim());
    for (const alias of Array.isArray(customer?.accountAliases) ? customer.accountAliases : []) {
      const aliasValue = String(alias || "").trim();
      if (aliasValue) searchKeys.add(aliasValue);
    }
  } catch (_) {
    // best effort lookup only
  }

  return [...searchKeys];
}

async function findPppSecretByAccount(tenantId, rawName, serverId) {
  const searchKeys = await getAccountSearchKeys(tenantId, rawName);

  for (const key of searchKeys) {
    const rows = await sendCommand("/ppp/secret/print", [qs("name", key)], {
      tenantId,
      timeoutMs: 10_000,
      serverId,
    });
    if (Array.isArray(rows) && rows[0]) {
      return { secret: rows[0], matchedName: key };
    }
  }

  return { secret: null, matchedName: rawName };
}

async function findQueueByName(tenantId, queueName, serverId) {
  const rows = await sendCommand("/queue/simple/print", [qs("name", String(queueName))], {
    tenantId,
    timeoutMs: 8_000,
    serverId,
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function syncStaticCustomerStatus(tenantId, accountNumber, status, queueSync, warningLabel) {
  try {
    const customerDoc = await Customer.findOne({
      tenantId,
      accountNumber: String(accountNumber),
      connectionType: "static",
    }).populate("plan");

    if (!customerDoc) return;

    await Customer.updateOne(
      { _id: customerDoc._id },
      { $set: { status, updatedAt: new Date() } }
    );

    const payload = customerDoc.toObject();
    payload.status = status;
    const planDoc = customerDoc.plan && typeof customerDoc.plan === "object" ? customerDoc.plan : null;

    await queueSync(payload, planDoc).catch(() => {});
  } catch (error) {
    console.warn(`[Mikrotik] ${warningLabel}:`, error?.message || error);
  }
}

async function enablePppoeAccount({ tenantId, serverId, account }) {
  const rawName = String(account || "").trim();
  const { secret } = await findPppSecretByAccount(tenantId, rawName, serverId);

  if (!secret) throw httpError(404, "User not found");

  const id = getRouterObjectId(secret);
  await sendCommand("/ppp/secret/set", [w("numbers", id), w("disabled", "no")], {
    tenantId,
    timeoutMs: 10_000,
    serverId,
  });

  return { ok: true, message: "Enabled" };
}

async function disablePppoeAccount({ tenantId, serverId, account, disconnect = true }) {
  const rawName = String(account || "").trim();
  const { secret, matchedName } = await findPppSecretByAccount(tenantId, rawName, serverId);

  if (!secret) throw httpError(404, "User not found");

  const id = getRouterObjectId(secret);
  await sendCommand("/ppp/secret/set", [w("numbers", id), w("disabled", "yes")], {
    tenantId,
    timeoutMs: 10_000,
    serverId,
  });

  if (disconnect) {
    const activeRows = await sendCommand("/ppp/active/print", [qs("name", matchedName)], {
      tenantId,
      timeoutMs: 8_000,
      serverId,
    });
    if (Array.isArray(activeRows) && activeRows[0]) {
      const activeId = getRouterObjectId(activeRows[0]);
      await sendCommand("/ppp/active/remove", [w(".id", activeId)], {
        tenantId,
        timeoutMs: 8_000,
        serverId,
      });
    }
  }

  return { ok: true, message: "Disabled" };
}

async function applyStaticQueue({ tenantId, serverId, account, rateLimit, target }) {
  const queueName = String(account || "");
  const rate = String(rateLimit || "10M/2M");
  const queue = await findQueueByName(tenantId, queueName, serverId);

  if (queue) {
    const queueId = getRouterObjectId(queue);
    await sendCommand("/queue/simple/set", [w("numbers", queueId), w("max-limit", rate)], {
      tenantId,
      timeoutMs: 8_000,
      serverId,
    });
  } else {
    const queueTarget = String(target || "");
    if (!queueTarget) throw httpError(400, "target (ip/mask) required");

    await sendCommand(
      "/queue/simple/add",
      [w("name", queueName), w("target", queueTarget), w("max-limit", rate)],
      { tenantId, timeoutMs: 8_000, serverId }
    );
  }

  return { ok: true, message: "Queue applied" };
}

async function enableStaticQueue({ tenantId, serverId, account }) {
  const queue = await findQueueByName(tenantId, String(account), serverId);
  if (!queue) throw httpError(404, "Queue not found");

  const queueId = getRouterObjectId(queue);
  await sendCommand("/queue/simple/enable", [w("numbers", queueId)], {
    tenantId,
    timeoutMs: 8_000,
    serverId,
  });

  await syncStaticCustomerStatus(
    tenantId,
    account,
    "active",
    (payload, planDoc) => enableCustomerQueue(payload, planDoc),
    "enable queue post-processing failed"
  );

  return { ok: true, message: "Queue enabled" };
}

async function disableStaticQueue({ tenantId, serverId, account }) {
  const queue = await findQueueByName(tenantId, String(account), serverId);
  if (!queue) throw httpError(404, "Queue not found");

  const queueId = getRouterObjectId(queue);
  await sendCommand("/queue/simple/disable", [w("numbers", queueId)], {
    tenantId,
    timeoutMs: 8_000,
    serverId,
  });

  await syncStaticCustomerStatus(
    tenantId,
    account,
    "inactive",
    (payload) => disableCustomerQueue(payload),
    "disable queue post-processing failed"
  );

  return { ok: true, message: "Queue disabled" };
}

module.exports = {
  applyStaticQueue,
  disablePppoeAccount,
  disableStaticQueue,
  enablePppoeAccount,
  enableStaticQueue,
};
