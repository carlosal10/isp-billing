'use strict';

// Enforce router-side disconnection for customers flagged inactive/expired.
// - STATIC: disable queue + block address list (handled also by expireStatic, but we ensure here too)
// - PPPoE: disable secret and kick active session if present

const cron = require('node-cron');
const Customer = require('../models/customers');
const { sendCommand } = require('../utils/mikrotikConnectionManager');
const { disableCustomerQueue } = require('../utils/mikrotikBandwidthManager');

async function enforcePppoe(tenantId, customer) {
  /**
   * Disable a PPPoE secret and kick active session for the given customer.
   * To improve robustness, build a set of candidate names from the customer's
   * account number and any aliases. Iterate through these candidates until a
   * matching secret is found. This mirrors logic used in manual routes and
   * prevents failures when the secret is stored under an alias or trimmed
   * variant of the account.
   */
  const timeoutMs = 10000;
  const candidates = new Set();
  // Primary account number
  if (customer && customer.accountNumber) {
    const primary = String(customer.accountNumber).trim();
    if (primary) candidates.add(primary);
  }
  // Include aliases if present
  if (customer && Array.isArray(customer.accountAliases)) {
    for (const alias of customer.accountAliases) {
      if (!alias) continue;
      const cleaned = String(alias).trim();
      if (cleaned) candidates.add(cleaned);
    }
  }
  if (candidates.size === 0) return;
  try {
    let found = false;
    for (const name of candidates) {
      // Disable PPP secret for this candidate
      const secrets = await sendCommand('/ppp/secret/print', [`?name=${name}`], { tenantId, timeoutMs }).catch(() => []);
      if (Array.isArray(secrets) && secrets[0]) {
        const id = secrets[0]['.id'] || secrets[0].numbers;
        if (id) {
          await sendCommand('/ppp/secret/set', [`=numbers=${id}`, `=disabled=yes`], { tenantId, timeoutMs }).catch(() => {});
        }
        // Kick active session if present
        const act = await sendCommand('/ppp/active/print', [`?name=${name}`], { tenantId, timeoutMs }).catch(() => []);
        if (Array.isArray(act) && act[0]) {
          const aid = act[0]['.id'] || act[0].numbers;
          if (aid) await sendCommand('/ppp/active/remove', [`=.id=${aid}`], { tenantId, timeoutMs }).catch(() => {});
        }
        found = true;
        break;
      }
    }
    if (!found) {
      console.warn('[enforce] PPPoE enforce: no secret found', { tenantId, account: Array.from(candidates).join(',') });
    }
  } catch (e) {
    console.warn('[enforce] PPPoE enforce failed', { tenantId, account: Array.from(candidates).join(','), err: e?.message || e });
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
  let totalStatic = 0;
  let totalPppoe = 0;
  for (const tid of tenants) {
    const tenantId = String(tid);
    const now = new Date();
    let tenantStatic = 0;
    let tenantPppoe = 0;
        const newlyExpired = await Customer.find({
          tenantId,
          expiryDate: { $lt: now },
          status: { $nin: ['inactive', 'expired'] },
        })
          // select accountAliases so enforcePppoe can consider aliases
          .select('tenantId accountNumber accountAliases connectionType staticConfig')
          .lean()
          .catch(() => []);

    for (const c of newlyExpired) {
      await Customer.updateOne(
        { _id: c._id, tenantId },
        { $set: { status: 'inactive', updatedAt: now } }
      ).catch(() => {});
    }

        let list = await Customer.find({ tenantId, status: { $in: ['inactive', 'expired'] } })
          // select accountAliases so enforcePppoe can consider aliases
          .select('tenantId accountNumber accountAliases connectionType staticConfig')
          .lean()
          .catch(() => []);

    if (Array.isArray(newlyExpired) && newlyExpired.length) {
      const seen = new Set(list.map((c) => String(c._id)));
      for (const c of newlyExpired) {
        const key = String(c._id);
        if (!seen.has(key)) {
          list.push(c);
          seen.add(key);
        }
      }
    }

    for (const c of list) {
      if (c.connectionType === 'pppoe') {
        await enforcePppoe(tenantId, c);
        tenantPppoe += 1;
        totalPppoe += 1;
      } else if (c.connectionType === 'static') {
        await enforceStatic(tenantId, c);
        tenantStatic += 1;
        totalStatic += 1;
      }
    }

    console.log('[enforce] tenant enforcement summary', {
      tenantId,
      staticEnforced: tenantStatic,
      pppoeEnforced: tenantPppoe,
    });
  }
  return { tenants: tenants.length, staticEnforced: totalStatic, pppoeEnforced: totalPppoe };
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
