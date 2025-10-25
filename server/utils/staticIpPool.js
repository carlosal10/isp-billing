const Tenant = require('../models/Tenant');
const Customer = require('../models/customers');
const net = require('net');

/**
 * Allocate the next available static IP address for a tenant.
 * The tenant document should define a `staticIpPool` array containing IP
 * addresses that can be assigned. This helper iterates over the pool and
 * returns the first IP that is not currently assigned to any customer. If
 * the pool is exhausted, an error will be thrown.
 *
 * @param {Object} tenant - Tenant document
 * @returns {Promise<string>} - An available IP address
 */
async function allocateIp(tenant) {
  if (!tenant || !Array.isArray(tenant.staticIpPool) || tenant.staticIpPool.length === 0) {
    throw new Error('staticIpPool not configured for this tenant');
  }
  for (const ipAddr of tenant.staticIpPool) {
    const trimmed = String(ipAddr).trim();
    if (!trimmed) continue;
    // validate pool entry
    if (!net.isIP(trimmed)) {
      continue;
    }
    // Check if any customer currently uses this IP
    const used = await Customer.findOne({ 'staticConfig.ip': trimmed }).lean();
    if (!used) {
      return trimmed;
    }
  }
  throw new Error('No available static IP address in pool');
}

/**
 * Release a static IP back into the tenant's pool.
 * This helper does not remove the IP from the pool array – it simply
 * acts as a placeholder for any additional actions needed when freeing
 * addresses. If future functionality is needed (e.g. marking IPs as
 * available in an external system), implement it here.
 *
 * @param {Object} tenant - Tenant document
 * @param {string} ipAddr - The IP address to release
 */
async function releaseIp(/* tenant, ipAddr */) {
  // Currently a no-op. The uniqueness of static IPs is enforced on
  // allocation; once a customer is removed or updated, the IP simply
  // becomes available again for reallocation. If you integrate with an
  // external IP management system, add calls here.
  return;
}

// Validate IPv4 (exclude IPv6)
function isValidIPv4(ip) {
  try {
    return net.isIP(String(ip)) === 4;
  } catch {
    return false;
  }
}

// Allocate next available IP from a tenant's pool (by tenantId)
async function allocateFromPool(tenantId) {
  const tenant = await Tenant.findById(tenantId).lean();
  if (!tenant || !Array.isArray(tenant.staticIpPool) || tenant.staticIpPool.length === 0) {
    return null;
  }
  // Fetch used IPs globally
  const usedIps = await Customer.distinct('staticConfig.ip', { 'staticConfig.ip': { $ne: null } });
  const usedSet = new Set((usedIps || []).map((i) => String(i || '').trim()));
  for (const candidate of tenant.staticIpPool) {
    if (!candidate) continue;
    const ip = String(candidate).trim();
    if (!ip) continue;
    if (!isValidIPv4(ip)) continue;
    if (!usedSet.has(ip)) return ip;
  }
  return null;
}

// Check whether an IP is within the tenant's pool (if defined)
async function isIpInPool(tenantId, ip) {
  const tenant = await Tenant.findById(tenantId).lean();
  if (!tenant || !Array.isArray(tenant.staticIpPool) || tenant.staticIpPool.length === 0) return true;
  const norm = String(ip || '').trim();
  return tenant.staticIpPool.some((entry) => String(entry || '').trim() === norm);
}

module.exports = { allocateIp, releaseIp, isValidIPv4, allocateFromPool, isIpInPool };
