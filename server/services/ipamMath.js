'use strict';

function normalizeIPv4(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 4) return null;
  const normalized = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) return null;
    normalized.push(String(num));
  }
  return normalized.join('.');
}

function ipv4ToInt(value) {
  const normalized = normalizeIPv4(value);
  if (!normalized) return null;
  return normalized
    .split('.')
    .map((part) => Number(part))
    .reduce((acc, part) => ((acc << 8) >>> 0) + part, 0) >>> 0;
}

function intToIPv4(value) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0 || num > 0xffffffff) return null;
  return [
    (num >>> 24) & 255,
    (num >>> 16) & 255,
    (num >>> 8) & 255,
    num & 255,
  ].join('.');
}

function parseCidr(value) {
  const raw = String(value || '').trim();
  const [ipPart, prefixPart] = raw.split('/');
  const ip = normalizeIPv4(ipPart);
  const prefixLength = Number(prefixPart);
  if (!ip || !Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 32) {
    throw new Error('Invalid CIDR range');
  }

  const maskInt =
    prefixLength === 0
      ? 0
      : ((0xffffffff << (32 - prefixLength)) >>> 0);
  const ipInt = ipv4ToInt(ip);
  const networkInt = (ipInt & maskInt) >>> 0;
  const broadcastInt = (networkInt | (~maskInt >>> 0)) >>> 0;
  const usableHostCount =
    prefixLength >= 31 ? 0 : Math.max(0, broadcastInt - networkInt - 1);
  const firstHostInt = usableHostCount > 0 ? networkInt + 1 : null;
  const lastHostInt = usableHostCount > 0 ? broadcastInt - 1 : null;
  const normalizedCidr = `${intToIPv4(networkInt)}/${prefixLength}`;

  return {
    cidr: normalizedCidr,
    prefixLength,
    networkInt,
    broadcastInt,
    networkAddress: intToIPv4(networkInt),
    broadcastAddress: intToIPv4(broadcastInt),
    firstHost: firstHostInt === null ? null : intToIPv4(firstHostInt),
    lastHost: lastHostInt === null ? null : intToIPv4(lastHostInt),
    usableHostCount,
    contains(candidate) {
      const candidateInt = ipv4ToInt(candidate);
      if (candidateInt === null) return false;
      return candidateInt >= networkInt && candidateInt <= broadcastInt;
    },
    isUsableHost(candidate) {
      const candidateInt = ipv4ToInt(candidate);
      if (candidateInt === null || usableHostCount <= 0) return false;
      return candidateInt >= firstHostInt && candidateInt <= lastHostInt;
    },
  };
}

function normalizeIpList(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(/[\n,\s]+/g);
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const ip = normalizeIPv4(item);
    if (!ip || seen.has(ip)) continue;
    seen.add(ip);
    out.push(ip);
  }
  return out;
}

function resolveAddressUniverse(source) {
  if (source && typeof source === 'object' && source.allocationStrategy === 'list') {
    return {
      mode: 'list',
      allowedIpList: normalizeIpList(source.addressList),
      gateway: normalizeIPv4(source.gateway),
    };
  }
  if (source && typeof source === 'object' && Array.isArray(source.allowedIpList)) {
    return {
      mode: 'list',
      allowedIpList: normalizeIpList(source.allowedIpList),
      gateway: normalizeIPv4(source.gateway),
    };
  }
  const parsed = typeof source === 'string' || (source && source.cidr)
    ? parseCidr(typeof source === 'string' ? source : source.cidr)
    : source;
  return {
    mode: 'cidr',
    parsed,
    gateway: normalizeIPv4(source?.gateway),
  };
}

function resolvePoolSource(value, gateway = null) {
  if (
    value &&
    typeof value === 'object' &&
    (value.allocationStrategy || value.cidr || value.networkAddress || Array.isArray(value.addressList))
  ) {
    return value;
  }
  if (value && typeof value === 'object' && value.firstHost && value.lastHost) {
    return value;
  }
  return { cidr: value, gateway };
}

function pickNextAvailableIp({ cidr, usedIps = [], excludedIps = [] }) {
  const used = new Set(usedIps.map((ip) => normalizeIPv4(ip)).filter(Boolean));
  const excluded = new Set(excludedIps.map((ip) => normalizeIPv4(ip)).filter(Boolean));
  const source = resolvePoolSource(cidr);
  const universe = resolveAddressUniverse(source);

  if (universe.mode === 'list') {
    const allowed = universe.allowedIpList || [];
    for (const candidate of allowed) {
      if (!candidate) continue;
      if (used.has(candidate) || excluded.has(candidate)) continue;
      return candidate;
    }
    return null;
  }

  const parsed = universe.parsed;
  if (!parsed.usableHostCount) return null;

  const firstInt = ipv4ToInt(parsed.firstHost);
  const lastInt = ipv4ToInt(parsed.lastHost);

  for (let current = firstInt; current <= lastInt; current += 1) {
    const candidate = intToIPv4(current);
    if (used.has(candidate) || excluded.has(candidate)) continue;
    return candidate;
  }
  return null;
}

function poolUsageFromAssignments(cidr, assignments = [], gateway = null) {
  const allocatedCount = assignments.filter((item) => item.status === 'allocated').length;
  const reservedCount = assignments.filter((item) => item.status === 'reserved').length;
  const source = resolvePoolSource(cidr, gateway);
  const universe = resolveAddressUniverse(source);
  const assignedSet = new Set(assignments.map((item) => normalizeIPv4(item.ipAddress)).filter(Boolean));

  let usableHostCount = 0;
  let gatewayReserved = 0;

  if (universe.mode === 'list') {
    const allowed = universe.allowedIpList || [];
    usableHostCount = allowed.length;
    const gatewayIp = universe.gateway;
    gatewayReserved =
      gatewayIp && allowed.includes(gatewayIp) && !assignedSet.has(gatewayIp)
        ? 1
        : 0;
  } else {
    const parsed = universe.parsed;
    const gatewayIp = universe.gateway;
    usableHostCount = parsed.usableHostCount;
    gatewayReserved =
      gatewayIp && parsed.isUsableHost(gatewayIp) && !assignedSet.has(gatewayIp)
        ? 1
        : 0;
  }

  const freeCount = Math.max(0, usableHostCount - allocatedCount - reservedCount - gatewayReserved);

  return {
    usableHostCount,
    allocatedCount,
    reservedCount,
    gatewayReserved,
    freeCount,
    utilizationPct:
      usableHostCount > 0
        ? Math.round(((allocatedCount + reservedCount + gatewayReserved) / usableHostCount) * 100)
        : 0,
  };
}

module.exports = {
  normalizeIPv4,
  normalizeIpList,
  ipv4ToInt,
  intToIPv4,
  parseCidr,
  pickNextAvailableIp,
  poolUsageFromAssignments,
};
