const Customer = require("../models/customers");
const {
  delay,
  firstIpFromTarget,
  isPrivateIPv4,
  mapHotspotActiveRow,
  mapPPPActiveRow,
  rosPrint,
  stringValue,
} = require("./mikrotikSupport");

function queryFlagDefaultTrue(value) {
  return String(value || "true").toLowerCase() !== "false";
}

function queryFlagDefaultFalse(value) {
  return String(value || "false").toLowerCase() === "true";
}

function buildLanInterfaceSet(bridges, vlans) {
  return new Set([
    ...((Array.isArray(bridges) ? bridges : []).map((bridge) => stringValue(bridge?.name)).filter(Boolean)),
    ...((Array.isArray(vlans) ? vlans : []).map((vlan) => stringValue(vlan?.name || vlan?.interface)).filter(Boolean)),
  ]);
}

async function loadLanInterfaces(tenantId, serverId) {
  const bridges = await rosPrint(tenantId, "/interface/bridge/print", [], 8_000, {
    heavy: false,
    serverId,
  });
  await delay(40);
  const vlans = await rosPrint(tenantId, "/interface/vlan/print", [], 8_000, {
    heavy: false,
    serverId,
  });
  return buildLanInterfaceSet(bridges, vlans);
}

function pushCandidate(map, ip, source, label, privateOnly) {
  const key = String(ip || "").trim();
  if (!key) return;
  if (privateOnly && !isPrivateIPv4(key)) return;

  const entry = map.get(key) || { ip: key, sources: [], label: "" };
  if (!entry.sources.includes(source)) entry.sources.push(source);
  if (!entry.label && label) entry.label = label;
  map.set(key, entry);
}

async function getRouterStatus({ tenantId, serverId }) {
  try {
    const identityRows = await rosPrint(tenantId, "/system/identity/print", [], 10_000, {
      heavy: false,
      serverId,
    });
    await delay(50);
    const resourceRows = await rosPrint(tenantId, "/system/resource/print", [], 10_000, {
      heavy: false,
      serverId,
    });
    await delay(100);
    const ipRows = await rosPrint(tenantId, "/ip/address/print", [], 15_000, {
      heavy: false,
      serverId,
    });

    const identity = identityRows[0]?.name || "";
    const uptime = resourceRows[0]?.uptime || "";
    const routerIp = (ipRows.find((row) => row.address)?.address || "").split("/")[0] || "";
    const connected = Boolean(identity || uptime || routerIp);

    return {
      ok: true,
      connected,
      identity,
      routerIp,
      uptime,
    };
  } catch {
    return { ok: true, connected: false, identity: "", routerIp: "", uptime: "" };
  }
}

async function getRouterPing({ tenantId, serverId }) {
  const identityRows = await rosPrint(tenantId, "/system/identity/print", [], 10_000, {
    heavy: false,
    serverId,
  });
  return { ok: true, connected: Boolean(identityRows[0]?.name) };
}

async function listPppoeActive({ tenantId, serverId }) {
  const cacheKey = `pppoe_active:${tenantId}`;
  const rows = await rosPrint(tenantId, "/ppp/active/print", [], 10_000, {
    heavy: true,
    cacheKey,
    cacheTtlMs: 10_000,
    allowStaleMs: 30_000,
    serverId,
  });

  return { ok: true, count: rows.length, users: rows.map(mapPPPActiveRow) };
}

async function listHotspotActive({ tenantId, serverId }) {
  const cacheKey = `hotspot_active:${tenantId}`;
  const rows = await rosPrint(tenantId, "/ip/hotspot/active/print", [], 10_000, {
    heavy: true,
    cacheKey,
    cacheTtlMs: 10_000,
    allowStaleMs: 30_000,
    serverId,
  });

  return { ok: true, count: rows.length, users: rows.map(mapHotspotActiveRow) };
}

async function listSimpleQueues({ tenantId, serverId, query = {} }) {
  const privateOnly = queryFlagDefaultTrue(query.privateOnly);

  try {
    const rows = await rosPrint(tenantId, "/queue/simple/print", [], 10_000, {
      heavy: false,
      serverId,
    });
    const queues = (Array.isArray(rows) ? rows : [])
      .map((row) => {
        const target = stringValue(row?.target || row?.["target"] || "");
        const ip = firstIpFromTarget(target);
        return {
          name: stringValue(row?.name),
          target,
          ip,
          comment: stringValue(row?.comment),
          maxLimit: stringValue(row?.["max-limit"] || row?.maxLimit || ""),
        };
      })
      .filter((row) => row.ip && (!privateOnly || isPrivateIPv4(row.ip)));

    return { ok: true, count: queues.length, queues };
  } catch (error) {
    return {
      ok: false,
      count: 0,
      queues: [],
      error: error?.message || "Failed to load queues",
    };
  }
}

async function listArpEntries({ tenantId, serverId, query = {} }) {
  const lanOnly = queryFlagDefaultTrue(query.lanOnly);
  const privateOnly = queryFlagDefaultTrue(query.privateOnly);
  const permanentOnly = queryFlagDefaultTrue(query.permanentOnly);

  try {
    const arps = await rosPrint(tenantId, "/ip/arp/print", [], 12_000, {
      heavy: true,
      cacheKey: `arp:${tenantId}`,
      cacheTtlMs: 8_000,
      allowStaleMs: 30_000,
      serverId,
    });
    await delay(80);
    const lanInterfaces = lanOnly ? await loadLanInterfaces(tenantId, serverId) : new Set();

    const mapped = (Array.isArray(arps) ? arps : [])
      .map((row) => ({
        address: stringValue(row?.address),
        interface: stringValue(row?.interface),
        mac: stringValue(row?.["mac-address"]),
        type: stringValue(row?.type),
        dynamic: stringValue(row?.dynamic),
        comment: stringValue(row?.comment),
      }))
      .filter((row) => {
        if (!row.address) return false;
        if (privateOnly && !isPrivateIPv4(row.address)) return false;
        if (lanOnly && row.interface && lanInterfaces.size && !lanInterfaces.has(row.interface)) return false;
        if (permanentOnly) {
          const isDynamic = String(row.dynamic || "no").toLowerCase() === "yes";
          const entryType = String(row.type || "").toLowerCase();
          if (isDynamic && entryType !== "static") return false;
        }
        return true;
      });

    return { ok: true, count: mapped.length, arps: mapped };
  } catch (error) {
    return {
      ok: false,
      count: 0,
      arps: [],
      error: error?.message || "Failed to load ARP",
    };
  }
}

async function listStaticCandidates({ tenantId, serverId, query = {} }) {
  const include = String(query.include || "queues,lists,secrets,arp")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const lanOnly = queryFlagDefaultFalse(query.lanOnly);
  const privateOnly = queryFlagDefaultFalse(query.privateOnly);
  const permanentOnly = queryFlagDefaultFalse(query.permanentOnly);
  const trustLists = queryFlagDefaultTrue(query.trustLists);

  try {
    const wantQueues = include.includes("queues");
    const wantLists = include.includes("lists");
    const wantSecrets = include.includes("secrets");
    const wantArp = include.includes("arp");

    const lists = wantLists
      ? await rosPrint(tenantId, "/ip/firewall/address-list/print", [], 15_000, {
          heavy: true,
          cacheKey: `lists:${tenantId}`,
          cacheTtlMs: 10_000,
          serverId,
        })
      : [];
    await delay(120);
    const queues = wantQueues
      ? await rosPrint(tenantId, "/queue/simple/print", [], 15_000, {
          heavy: false,
          serverId,
        })
      : [];
    await delay(140);
    const secrets = wantSecrets
      ? await rosPrint(tenantId, "/ppp/secret/print", [], 12_000, {
          heavy: true,
          cacheKey: `secrets:${tenantId}`,
          cacheTtlMs: 10_000,
          serverId,
        })
      : [];
    await delay(120);
    const arps = wantArp
      ? await rosPrint(tenantId, "/ip/arp/print", [], 15_000, {
          heavy: true,
          cacheKey: `arp:${tenantId}`,
          cacheTtlMs: 8_000,
          serverId,
        })
      : [];
    await delay(60);
    const lanInterfaces = lanOnly ? await loadLanInterfaces(tenantId, serverId) : new Set();

    const candidates = new Map();
    for (const queue of queues || []) {
      const ip = firstIpFromTarget(stringValue(queue?.target || queue?.["target"]));
      if (!ip) continue;
      pushCandidate(candidates, ip, "queue", stringValue(queue?.comment) || stringValue(queue?.name), privateOnly);
    }

    for (const row of lists || []) {
      const listName = stringValue(row?.list);
      if (!listName) continue;
      if (!trustLists && listName !== "STATIC_ALLOW" && listName !== "STATIC_BLOCK") continue;

      const ip = stringValue(row?.address);
      if (!ip) continue;

      const comment = stringValue(row?.comment);
      const label = comment ? `${listName} - ${comment}` : listName;
      pushCandidate(candidates, ip, `list:${listName}`, label, privateOnly);
    }

    for (const secret of secrets || []) {
      const ip = stringValue(secret?.["remote-address"]);
      if (!ip) continue;
      pushCandidate(candidates, ip, "ppp-secret", `ppp secret ${stringValue(secret?.name)}`, privateOnly);
    }

    for (const arp of arps || []) {
      const ip = stringValue(arp?.address);
      if (!ip) continue;

      if (lanOnly && lanInterfaces.size) {
        const iface = stringValue(arp?.interface);
        if (iface && !lanInterfaces.has(iface)) continue;
      }

      if (permanentOnly) {
        const isDynamic = String(arp?.dynamic || "no").toLowerCase() === "yes";
        const entryType = String(arp?.type || "").toLowerCase();
        if (isDynamic && entryType !== "static") continue;
      }

      const comment = stringValue(arp?.comment);
      const label = comment ? `${stringValue(arp?.interface)} - ${comment}` : stringValue(arp?.interface);
      pushCandidate(candidates, ip, "arp", label, privateOnly);
    }

    return {
      ok: true,
      count: candidates.size,
      candidates: Array.from(candidates.values()),
    };
  } catch (error) {
    return {
      ok: false,
      count: 0,
      candidates: [],
      error: error?.message || "Failed to load candidates",
    };
  }
}

async function listStaticActive({ tenantId, serverId }) {
  try {
    const lists = await rosPrint(tenantId, "/ip/firewall/address-list/print", [], 12_000, {
      heavy: true,
      cacheKey: `lists:${tenantId}`,
      cacheTtlMs: 10_000,
      serverId,
    });
    await delay(80);
    const queues = await rosPrint(tenantId, "/queue/simple/print", [], 15_000, {
      heavy: false,
      serverId,
    });
    await delay(120);
    const arps = await rosPrint(tenantId, "/ip/arp/print", [], 15_000, {
      heavy: true,
      cacheKey: `arp:${tenantId}`,
      cacheTtlMs: 8_000,
      serverId,
    });

    const ips = new Map();
    for (const queue of Array.isArray(queues) ? queues : []) {
      const queueName = stringValue(queue?.name);
      const ip = firstIpFromTarget(queue?.target || queue?.["target"] || "");
      if (!ip) continue;
      if (!ips.has(ip)) ips.set(ip, queueName || null);
    }

    for (const row of Array.isArray(lists) ? lists : []) {
      if (stringValue(row?.list) !== "STATIC_ALLOW") continue;
      const ip = stringValue(row?.address);
      if (ip && !ips.has(ip)) ips.set(ip, null);
    }

    const arpMap = new Map((Array.isArray(arps) ? arps : []).map((row) => [stringValue(row?.address), row]));
    const wantIps = [...ips.keys()];
    const customers = await Customer.find({
      tenantId,
      connectionType: "static",
      "staticConfig.ip": { $in: wantIps },
    })
      .select("accountNumber staticConfig.ip")
      .lean();
    const ipToAccount = new Map(
      customers.map((customer) => [stringValue(customer?.staticConfig?.ip), stringValue(customer?.accountNumber)])
    );

    const users = [];
    for (const [ip, queueName] of ips) {
      const arp = arpMap.get(ip);
      if (!arp) continue;

      const username = queueName || ipToAccount.get(ip) || ip.replace(/\./g, "-");
      users.push({
        username,
        address: ip,
        uptime: stringValue(arp?.["last-seen"] || arp?.uptime || ""),
        "bytes-in": 0,
        "bytes-out": 0,
        _raw: { source: "static", arp },
      });
    }

    return { ok: true, count: users.length, users };
  } catch (error) {
    console.warn("[Mikrotik] static/active failed:", error?.message || error);
    return { ok: true, count: 0, users: [] };
  }
}

async function getOnlineCounts({ tenantId, serverId }) {
  const pppoe = await rosPrint(tenantId, "/ppp/active/print", [], 12_000, {
    heavy: true,
    cacheKey: `pppoe_active:${tenantId}`,
    cacheTtlMs: 10_000,
    allowStaleMs: 30_000,
    serverId,
  });
  await delay(100);
  const hotspot = await rosPrint(tenantId, "/ip/hotspot/active/print", [], 12_000, {
    heavy: true,
    cacheKey: `hotspot_active:${tenantId}`,
    cacheTtlMs: 10_000,
    allowStaleMs: 30_000,
    serverId,
  });

  return {
    ok: true,
    pppoe: { count: (pppoe || []).length },
    hotspot: { count: (hotspot || []).length },
    total: (pppoe || []).length + (hotspot || []).length,
  };
}

module.exports = {
  getOnlineCounts,
  getRouterPing,
  getRouterStatus,
  listArpEntries,
  listHotspotActive,
  listPppoeActive,
  listSimpleQueues,
  listStaticActive,
  listStaticCandidates,
};
