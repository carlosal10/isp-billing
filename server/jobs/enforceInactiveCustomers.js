'use strict';

// Enforce router-side disconnection for customers flagged inactive/expired.
// - STATIC: disable queue + block address list (handled also by expireStatic, but we ensure here too)
// - PPPoE: disable secret and kick active session if present

const cron = require('node-cron');
const Customer = require('../models/customers');
const { sendCommand } = require('../utils/mikrotikConnectionManager');
const { disableCustomerQueue } = require('../utils/mikrotikBandwidthManager');

async function enforcePppoe(tenantId, customer) {
  const name = String(customer.accountNumber || '').trim();
  if (!name) return;
  const timeoutMs = 10000;
  try {
    // Disable PPP secret
    const secrets = await sendCommand('/ppp/secret/print', [`?name=${name}`], { tenantId, timeoutMs }).catch(() => []);
    if (Array.isArray(secrets) && secrets[0]) {
      const id = secrets[0]['.id'] || secrets[0].numbers;
      if (id) {
        await sendCommand('/ppp/secret/set', [`=numbers=${id}`, `=disabled=yes`], { tenantId, timeoutMs }).catch(() => {});
      }
    }
    // Kick active session
    const act = await sendCommand('/ppp/active/print', [`?name=${name}`], { tenantId, timeoutMs }).catch(() => []);
    if (Array.isArray(act) && act[0]) {
      const aid = act[0]['.id'] || act[0].numbers;
      if (aid) await sendCommand('/ppp/active/remove', [`=.id=${aid}`], { tenantId, timeoutMs }).catch(() => {});
    }
  } catch (e) {
    console.warn('[enforce] PPPoE enforce failed', { tenantId, account: name, err: e?.message || e });
  }
}

async function enforceStatic(tenantId, customer) {
  try {
    await disableCustomerQueue(customer).catch(() => {});
  } catch (e) {
    console.warn('[enforce] STATIC enforce failed', { tenantId, account: String(customer.accountNumber || ''), err: e?.message || e });
  }
}

async function runOnce() {
  // Find all inactive customers per tenant and enforce
  const tenants = await Customer.distinct('tenantId').catch(() => []);
  for (const tid of tenants) {
    const tenantId = String(tid);
    const list = await Customer.find({ tenantId, status: { $in: ['inactive', 'expired'] } })
      .select('tenantId accountNumber connectionType staticConfig')
      .lean()
      .catch(() => []);
    for (const c of list) {
      if (c.connectionType === 'pppoe') await enforcePppoe(tenantId, c);
      else if (c.connectionType === 'static') await enforceStatic(tenantId, c);
    }
  }
  return { tenants: tenants.length };
}

// Every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  try {
    const out = await runOnce();
    if (out?.tenants != null) console.log('[enforce] cycle done', out);
  } catch (e) {
    console.error('[enforce] cycle error', e?.message || e);
  }
});

console.log('[enforce] inactive customers enforcement scheduled (*/5)');

module.exports = {};

