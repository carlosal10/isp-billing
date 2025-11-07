// utils/mikrotikBandwidthManager.js
const { sendCommand } = require('./mikrotikConnectionManager');

const qs = (k, v) => '?' + k + '=' + v;
const w = (k, v) => '=' + k + '=' + v;

const DEFAULT_TIMEOUT = 8000;
const STATIC_ALLOW = 'STATIC_ALLOW';
const STATIC_BLOCK = 'STATIC_BLOCK';
const RETRY_COUNT = 3;
const RETRY_DELAY_MS = 350;

const isYes = (v) => {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === '1';
};

const firstQueueTargetIp = (target) => {
  if (!target) return '';
  const first = String(target).split(',')[0].trim();
  return first.split('/')[0].trim();
};

const safeIp = (ip) => {
  const value = String(ip == null ? '' : ip).trim();
  return value && value.toLowerCase() !== 'undefined' ? value : '';
};

async function fetchQueueByName(tenantId, name) {
  try {
    const rows = await sendCommand('/queue/simple/print', [qs('name', String(name))], { tenantId, timeoutMs: DEFAULT_TIMEOUT });
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!row) return null;
    const id = row['.id'] || row.id || row.numbers;
    return {
      id,
      disabled: row.disabled ?? 'no',
      target: row.target || row['target-addresses'] || '',
      maxLimit: row['max-limit'] || row.maxLimit || '',
      comment: row.comment || '',
      row,
    };
  } catch (err) {
    return null;
  }
}

async function ensureList(tenantId, list) {
  const rows = await sendCommand('/ip/firewall/address-list/print', [qs('list', list)], { tenantId, timeoutMs: DEFAULT_TIMEOUT }).catch(() => []);
  if (Array.isArray(rows) && rows.length > 0) return;
  await sendCommand(
    '/ip/firewall/address-list/add',
    [
      w('list', list),
      w('comment', list === STATIC_ALLOW ? 'Billing: allowed static' : list === STATIC_BLOCK ? 'Billing: blocked static' : 'Billing: managed'),
    ],
    { tenantId, timeoutMs: DEFAULT_TIMEOUT }
  ).catch(() => {});
}

async function _sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// Ensure an address entry exists in `list`. This is idempotent and will retry
// on transient failures. If the address exists in the opposing list it will be
// removed to keep STATIC_ALLOW/STATIC_BLOCK mutually exclusive.
async function ensureAddressListEntry(tenantId, list, ip, comment) {
  const addr = safeIp(ip);
  if (!addr) return;
  await ensureList(tenantId, list);
  for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
    try {
      const rows = await sendCommand('/ip/firewall/address-list/print', [qs('list', list), qs('address', addr)], { tenantId, timeoutMs: DEFAULT_TIMEOUT }).catch(() => []);
      const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
      if (!row) {
        const words = [w('list', list), w('address', addr)];
        if (comment) words.push(w('comment', comment));
        await sendCommand('/ip/firewall/address-list/add', words, { tenantId, timeoutMs: DEFAULT_TIMEOUT }).catch(() => { throw new Error('add-failed'); });
      } else if (comment && row.comment !== comment) {
        const id = row['.id'] || row.id || row.numbers;
        if (id) {
          await sendCommand('/ip/firewall/address-list/set', [w('numbers', id), w('comment', comment)], { tenantId, timeoutMs: DEFAULT_TIMEOUT }).catch(() => { throw new Error('set-failed'); });
        }
      }

      // Ensure the address is not present in the opposite list
      const other = list === STATIC_ALLOW ? STATIC_BLOCK : STATIC_ALLOW;
      await removeAddressListEntry(tenantId, other, addr).catch(() => {});

      // verify presence
      const verify = await sendCommand('/ip/firewall/address-list/print', [qs('list', list), qs('address', addr)], { tenantId, timeoutMs: DEFAULT_TIMEOUT }).catch(() => []);
      if (Array.isArray(verify) && verify.length > 0) return;
      // otherwise fallthrough to retry
    } catch (err) {
      // swallow and retry below
    }
    if (attempt < RETRY_COUNT) await _sleep(RETRY_DELAY_MS);
  }
}

// Remove any address list entries for `ip` in `list`. Retries to be robust
// against transient router failures and confirms removal.
async function removeAddressListEntry(tenantId, list, ip) {
  const addr = safeIp(ip);
  if (!addr) return;
  for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
    try {
      const rows = await sendCommand('/ip/firewall/address-list/print', [qs('list', list), qs('address', addr)], { tenantId, timeoutMs: DEFAULT_TIMEOUT }).catch(() => []);
      const items = Array.isArray(rows) ? rows : [];
      for (const row of items) {
        const id = row['.id'] || row.id || row.numbers;
        if (id) {
          await sendCommand('/ip/firewall/address-list/remove', [w('numbers', id)], { tenantId, timeoutMs: DEFAULT_TIMEOUT }).catch(() => { throw new Error('remove-failed'); });
        }
      }

      // verify none remain
      const verify = await sendCommand('/ip/firewall/address-list/print', [qs('list', list), qs('address', addr)], { tenantId, timeoutMs: DEFAULT_TIMEOUT }).catch(() => []);
      if (!Array.isArray(verify) || verify.length === 0) return;
    } catch (err) {
      // ignore and retry
    }
    if (attempt < RETRY_COUNT) await _sleep(RETRY_DELAY_MS);
  }
}

function resolveRateLimit(plan) {
  if (!plan || typeof plan !== 'object') return '10M/2M';
  if (plan.speed != null) return String(plan.speed) + 'M/0M';
  if (plan.rateLimit) return String(plan.rateLimit);
  if (plan.rate_limit) return String(plan.rate_limit);
  return '10M/2M';
}

function accountLabel(customer) {
  const raw = customer && (customer.accountNumber || customer._id || customer.id);
  const value = String(raw == null ? '' : raw).trim();
  return value || 'static-customer';
}

async function applyCustomerQueue(customer, plan) {
  try {
    const tenantId = String(customer && customer.tenantId ? customer.tenantId : '');
    if (!tenantId) throw new Error('Missing tenantId on customer');
    if (!customer || customer.connectionType !== 'static') return;

    const ip = safeIp(customer.staticConfig && customer.staticConfig.ip);
    if (!ip) throw new Error('Static IP missing for static connection');

    const queueName = accountLabel(customer);
    const planDoc = plan && typeof plan === 'object' ? plan : (customer && typeof customer.plan === 'object' ? customer.plan : null);
    const rateLimit = resolveRateLimit(planDoc);
    const comment = 'Customer: ' + (customer && customer.name ? customer.name : queueName);

    const queue = await fetchQueueByName(tenantId, queueName);
    const target = ip + '/32';

    if (queue && queue.id) {
      const updates = [w('numbers', queue.id)];
      if (!queue.target || firstQueueTargetIp(queue.target) !== ip) updates.push(w('target', target));
      if (rateLimit && queue.maxLimit !== rateLimit) updates.push(w('max-limit', rateLimit));
      if (comment && queue.comment !== comment) updates.push(w('comment', comment));
      if (updates.length > 1) {
        await sendCommand('/queue/simple/set', updates, { tenantId, timeoutMs: DEFAULT_TIMEOUT }).catch(() => {});
      }
      if (isYes(queue.disabled)) {
        await sendCommand('/queue/simple/enable', [w('numbers', queue.id)], { tenantId, timeoutMs: DEFAULT_TIMEOUT }).catch(() => {});
      }
    } else {
      const words = [w('name', queueName), w('target', target)];
      if (rateLimit) words.push(w('max-limit', rateLimit));
      if (comment) words.push(w('comment', comment));
      await sendCommand('/queue/simple/add', words, { tenantId, timeoutMs: DEFAULT_TIMEOUT }).catch(() => {});
    }

    await ensureAddressListEntry(tenantId, STATIC_ALLOW, ip, comment);
    await removeAddressListEntry(tenantId, STATIC_BLOCK, ip);
  } catch (err) {
    const labelSource = customer && (customer.accountNumber || customer._id || customer.id) ? customer.accountNumber || customer._id || customer.id : 'unknown';
    console.error('Failed to apply queue for ' + labelSource + ':', err);
    throw err;
  }
}

async function removeCustomerQueue(customer) {
  try {
    const tenantId = String(customer && customer.tenantId ? customer.tenantId : '');
    if (!tenantId) throw new Error('Missing tenantId on customer');
    const queueName = accountLabel(customer);
    const queue = await fetchQueueByName(tenantId, queueName);
    if (queue && queue.id) {
      await sendCommand('/queue/simple/remove', [w('numbers', queue.id)], { tenantId, timeoutMs: DEFAULT_TIMEOUT }).catch(() => {});
    }
    if (customer && customer.connectionType === 'static') {
      const ip = safeIp(customer.staticConfig && customer.staticConfig.ip);
      await removeAddressListEntry(tenantId, STATIC_ALLOW, ip);
      await removeAddressListEntry(tenantId, STATIC_BLOCK, ip);
    }
  } catch (err) {
    const labelSource = customer && (customer.accountNumber || customer._id || customer.id) ? customer.accountNumber || customer._id || customer.id : 'unknown';
    console.error('Failed to remove queue for ' + labelSource + ':', err);
    throw err;
  }
}

async function updateCustomerQueue(customer, plan) {
  try {
    await applyCustomerQueue(customer, plan);
  } catch (err) {
    const labelSource = customer && (customer.accountNumber || customer._id || customer.id) ? customer.accountNumber || customer._id || customer.id : 'unknown';
    console.error('Failed to update queue for ' + labelSource + ':', err);
    throw err;
  }
}

async function disableCustomerQueue(customer) {
  try {
    const tenantId = String(customer && customer.tenantId ? customer.tenantId : '');
    if (!tenantId) throw new Error('Missing tenantId on customer');
    const queueName = accountLabel(customer);
    const queue = await fetchQueueByName(tenantId, queueName);
    if (queue && queue.id && !isYes(queue.disabled)) {
      await sendCommand('/queue/simple/disable', [w('numbers', queue.id)], { tenantId, timeoutMs: DEFAULT_TIMEOUT }).catch(() => {});
    }
    if (customer && customer.connectionType === 'static') {
      const ip = safeIp(customer.staticConfig && customer.staticConfig.ip);
      const comment = 'Blocked: ' + (customer && customer.name ? customer.name : queueName);
      await removeAddressListEntry(tenantId, STATIC_ALLOW, ip);
      await ensureAddressListEntry(tenantId, STATIC_BLOCK, ip, comment);
    }
  } catch (err) {
    const labelSource = customer && (customer.accountNumber || customer._id || customer.id) ? customer.accountNumber || customer._id || customer.id : 'unknown';
    console.error('Failed to disable queue for ' + labelSource + ':', err);
  }
}

async function enableCustomerQueue(customer, plan) {
  try {
    const tenantId = String(customer && customer.tenantId ? customer.tenantId : '');
    if (!tenantId) throw new Error('Missing tenantId on customer');
    const queueName = accountLabel(customer);
    const queue = await fetchQueueByName(tenantId, queueName);
    if (queue && queue.id) {
      if (isYes(queue.disabled)) {
        await sendCommand('/queue/simple/enable', [w('numbers', queue.id)], { tenantId, timeoutMs: DEFAULT_TIMEOUT }).catch(() => {});
      }
    } else if (customer && customer.connectionType === 'static') {
      await applyCustomerQueue(customer, plan);
      return;
    }
    if (customer && customer.connectionType === 'static') {
      const ip = safeIp(customer.staticConfig && customer.staticConfig.ip);
      const comment = 'Customer: ' + (customer && customer.name ? customer.name : queueName);
      await ensureAddressListEntry(tenantId, STATIC_ALLOW, ip, comment);
      await removeAddressListEntry(tenantId, STATIC_BLOCK, ip);
    }
  } catch (err) {
    const labelSource = customer && (customer.accountNumber || customer._id || customer.id) ? customer.accountNumber || customer._id || customer.id : 'unknown';
    console.error('Failed to enable queue for ' + labelSource + ':', err);
  }
}

async function applyBandwidth(customer, plan) {
  return applyCustomerQueue(customer, plan);
}

// Enable PPPoE secret for a customer using the same alias-search logic
async function enablePppoeSecret(customer) {
  try {
    const tenantId = String(customer && customer.tenantId ? customer.tenantId : '');
    if (!tenantId) throw new Error('Missing tenantId on customer');
    const candidates = [];
    if (customer?.accountNumber) candidates.push(String(customer.accountNumber).trim());
    if (Array.isArray(customer?.accountAliases)) {
      for (const a of customer.accountAliases) {
        if (a) candidates.push(String(a).trim());
      }
    }
    // try each candidate until we find a secret
    for (const name of candidates) {
      if (!name) continue;
      const rows = await sendCommand('/ppp/secret/print', ['?name=' + name], { tenantId, timeoutMs: DEFAULT_TIMEOUT }).catch(() => []);
      const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
      if (!row) continue;
      const id = row['.id'] || row.id || row.numbers;
      if (id) {
        await sendCommand('/ppp/secret/set', [w('numbers', id), w('disabled', 'no')], { tenantId, timeoutMs: DEFAULT_TIMEOUT }).catch(() => {});
        return true;
      }
    }
    return false;
  } catch (err) {
    console.error('enablePppoeSecret failed:', err);
    return false;
  }
}

// Disable PPPoE secret and remove any active sessions for the given customer
async function disablePppoeSecret(customer) {
  try {
    const tenantId = String(customer && customer.tenantId ? customer.tenantId : '');
    if (!tenantId) throw new Error('Missing tenantId on customer');
    const candidates = [];
    if (customer?.accountNumber) candidates.push(String(customer.accountNumber).trim());
    if (Array.isArray(customer?.accountAliases)) {
      for (const a of customer.accountAliases) {
        if (a) candidates.push(String(a).trim());
      }
    }
    for (const name of candidates) {
      if (!name) continue;
      const rows = await sendCommand('/ppp/secret/print', ['?name=' + name], { tenantId, timeoutMs: DEFAULT_TIMEOUT }).catch(() => []);
      const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
      if (!row) continue;
      const id = row['.id'] || row.id || row.numbers;
      if (id) {
        await sendCommand('/ppp/secret/set', [w('numbers', id), w('disabled', 'yes')], { tenantId, timeoutMs: DEFAULT_TIMEOUT }).catch(() => {});
      }
      const active = await sendCommand('/ppp/active/print', ['?name=' + name], { tenantId, timeoutMs: DEFAULT_TIMEOUT }).catch(() => []);
      for (const s of Array.isArray(active) ? active : []) {
        const sid = s['.id'] || s.id || s.numbers;
        if (!sid) continue;
        await sendCommand('/ppp/active/remove', [w('=.id', sid)], { tenantId, timeoutMs: DEFAULT_TIMEOUT }).catch(() => {});
      }
      return true;
    }
    return false;
  } catch (err) {
    console.error('disablePppoeSecret failed:', err);
    return false;
  }
}

module.exports = {
  applyCustomerQueue,
  applyBandwidth,
  removeCustomerQueue,
  updateCustomerQueue,
  disableCustomerQueue,
  enableCustomerQueue
  , enablePppoeSecret
  , disablePppoeSecret
};


