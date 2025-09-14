// utils/mikrotikBandwidthManager.js
const { sendCommand } = require('./mikrotikConnectionManager');

// RouterOS word helpers (align with other routes)
const qs = (k, v) => `?${k}=${v}`;
const w = (k, v) => `=${k}=${v}`;

async function getQueueIdByName(tenantId, name) {
  try {
    const rows = await sendCommand('/queue/simple/print', [qs('name', String(name))], { tenantId, timeoutMs: 8000 });
    const r0 = Array.isArray(rows) && rows[0] ? rows[0] : null;
    return r0 ? (r0['.id'] || r0.id || r0.numbers) : null;
  } catch {
    return null;
  }
}

/**
 * Apply bandwidth queue for a customer
 * @param {Object} customer - Customer object from DB
 * @param {Object} plan - Plan object from DB
 */
async function applyCustomerQueue(customer, plan) {
  try {
    const tenantId = String(customer.tenantId || '');
    if (!tenantId) throw new Error('Missing tenantId on customer');
    const rateLimit = plan && plan.speed ? `${plan.speed}M/0M` : '10M/2M';

    if (customer.connectionType === 'pppoe') {
      // PPPoE bandwidth is typically enforced via PPP profile rate-limit.
      // Skip creating a duplicate simple queue.
      return;
    }

    if (customer.connectionType === 'static') {
      const ip = customer?.staticConfig?.ip;
      if (!ip) throw new Error('Static IP missing for static connection');
      const name = String(customer.accountNumber);
      const id = await getQueueIdByName(tenantId, name);
      if (id) {
        // Update rate-limit
        await sendCommand('/queue/simple/set', [w('numbers', id), w('max-limit', rateLimit), w('comment', `Customer: ${customer.name || name}`)], { tenantId, timeoutMs: 8000 });
      } else {
        // Create new queue
        await sendCommand(
          '/queue/simple/add',
          [w('name', name), w('target', `${ip}/32`), w('max-limit', rateLimit), w('comment', `Customer: ${customer.name || name}`)],
          { tenantId, timeoutMs: 8000 }
        );
      }
    }
  } catch (err) {
    console.error(`Failed to apply queue for ${customer.accountNumber}:`, err);
    throw err;
  }
}

/**
 * Remove bandwidth queue for a customer
 */
async function removeCustomerQueue(customer) {
  try {
    const tenantId = String(customer.tenantId || '');
    if (!tenantId) throw new Error('Missing tenantId on customer');
    const id = await getQueueIdByName(tenantId, customer.accountNumber);
    if (!id) return;
    await sendCommand('/queue/simple/remove', [w('numbers', id)], { tenantId, timeoutMs: 8000 });
  } catch (err) {
    console.error(`Failed to remove queue for ${customer.accountNumber}:`, err);
    throw err;
  }
}

/**
 * Update customer's queue (e.g., plan change)
 */
async function updateCustomerQueue(customer, plan) {
  try {
    // Idempotent: apply will create or update max-limit
    await applyCustomerQueue(customer, plan);
  } catch (err) {
    console.error(`Failed to update queue for ${customer.accountNumber}:`, err);
    throw err;
  }
}

/**
 * Disable queue for customer (used for auto-disconnect)
 */
async function disableCustomerQueue(customer) {
  try {
    const tenantId = String(customer.tenantId || '');
    if (!tenantId) throw new Error('Missing tenantId on customer');
    const id = await getQueueIdByName(tenantId, customer.accountNumber);
    if (!id) return;
    await sendCommand('/queue/simple/disable', [w('numbers', id)], { tenantId, timeoutMs: 8000 });
  } catch (err) {
    console.error(`Failed to disable queue for ${customer.accountNumber}:`, err);
  }
}

/**
 * Enable queue for customer (used for reconnect)
 */
async function enableCustomerQueue(customer) {
  try {
    const tenantId = String(customer.tenantId || '');
    if (!tenantId) throw new Error('Missing tenantId on customer');
    const id = await getQueueIdByName(tenantId, customer.accountNumber);
    if (!id) return;
    await sendCommand('/queue/simple/enable', [w('numbers', id)], { tenantId, timeoutMs: 8000 });
  } catch (err) {
    console.error(`Failed to enable queue for ${customer.accountNumber}:`, err);
  }
}

module.exports = {
  applyCustomerQueue,
  removeCustomerQueue,
  updateCustomerQueue,
  disableCustomerQueue,
  enableCustomerQueue
};
