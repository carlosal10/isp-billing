// utils/mikrotikBandwidthManager.js
const { sendCommand } = require('./mikrotikConnectionManager');

/**
 * Apply bandwidth queue for a customer
 * @param {Object} customer - Customer object from DB
 * @param {Object} plan - Plan object from DB
 */
async function applyCustomerQueue(customer, plan) {
  try {
    const rateLimit = plan.speed ? `${plan.speed}M/0M` : '10M/2M'; // default if plan has no speed
    if (customer.connectionType === 'pppoe') {
      // PPPoE queue already applied via profile, but we can add a simple queue if needed
      await sendCommand('/queue/simple/add', {
        name: customer.accountNumber,
        target: customer.pppoeConfig.username,
        maxLimit: rateLimit,
        comment: `Customer: ${customer.name}`
      });
    } else if (customer.connectionType === 'static') {
      await sendCommand('/queue/simple/add', {
        name: customer.accountNumber,
        target: `${customer.staticConfig.ip}/32`,
        maxLimit: rateLimit,
        comment: `Customer: ${customer.name}`
      });
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
    await sendCommand('/queue/simple/remove', { numbers: customer.accountNumber });
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
    await removeCustomerQueue(customer);
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
    await sendCommand('/queue/simple/disable', { numbers: customer.accountNumber });
  } catch (err) {
    console.error(`Failed to disable queue for ${customer.accountNumber}:`, err);
  }
}

/**
 * Enable queue for customer (used for reconnect)
 */
async function enableCustomerQueue(customer) {
  try {
    await sendCommand('/queue/simple/enable', { numbers: customer.accountNumber });
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
