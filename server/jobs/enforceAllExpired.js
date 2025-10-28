'use strict';

/**
 * Unified enforcement job: handles static, PPPoE and hotspot expirations in a
 * single sweep to avoid race conditions and provide an audit trail.
 */

const { scheduleJob } = require('../utils/scheduler');
const { acquireLock, releaseLock } = require('../utils/jobLock');
const Customer = require('../models/customers');
const RegisteredHotspotUser = require('../models/RegisteredHotspotUser');
const RegisteredPPPoEUser = require('../models/pppoeUsers');
const { runExpirySweep } = require('./expireAccess');
const {
  disableCustomerQueue,
  removeCustomerQueue,
  disablePppoeSecret,
} = require('../utils/mikrotikBandwidthManager');
const { releaseIp } = require('../utils/staticIpPool');
const Tenant = require('../models/Tenant');

const LOCK_TTL = 4 * 60 * 1000; // 4 minutes

async function runUnifiedEnforce() {
  const acquired = await acquireLock('enforceAllExpired', LOCK_TTL);
  if (!acquired) {
    console.log('[enforceAllExpired] another run is in progress; skipping');
    return { skipped: true };
  }

  const summary = {
    hotspot: { scanned: 0, removed: 0, errors: 0 },
    pppoe: { scanned: 0, disabled: 0, errors: 0 },
    static: { scanned: 0, disabled: 0, errors: 0 },
    customersMarkedInactive: 0,
  };

  try {
    // First, run the existing hotspot/registered-pppoe expiry sweep (removes vouchers)
    const sweep = await runExpirySweep().catch((e) => { console.warn('[enforceAllExpired] expireAccess sweep failed', e?.message || e); return null; });
    if (sweep) {
      summary.hotspot.scanned = sweep.hotspotExpired || 0;
      summary.hotspot.removed = sweep.hotspotDisconnected || 0;
      summary.hotspot.errors = sweep.hotspotErrors || 0;
      summary.pppoe.scanned = sweep.pppoeExpired || 0;
      summary.pppoe.disabled = sweep.pppoeDisconnected || 0;
      summary.pppoe.errors = sweep.pppoeErrors || 0;
    }

    // Now find customers whose expiryDate passed and are not yet inactive/expired
    const now = new Date();
    const expiredCustomers = await Customer.find({ expiryDate: { $lt: now }, status: { $nin: ['inactive', 'expired'] } })
      .select('_id tenantId accountNumber accountAliases connectionType staticConfig')
      .lean()
      .catch(() => []);

    for (const c of expiredCustomers) {
      try {
        // mark inactive
        await Customer.updateOne({ _id: c._id }, { $set: { status: 'inactive', updatedAt: new Date() } }).catch(() => {});
        summary.customersMarkedInactive += 1;

        const tenantId = String(c.tenantId || '');
        if (c.connectionType === 'pppoe') {
          try {
            await disablePppoeSecret(c).catch(() => {});
            // also disable bandwidth queue if present
            await disableCustomerQueue(c).catch(() => {});
            summary.pppoe.disabled += 1;
          } catch (err) {
            summary.pppoe.errors += 1;
            console.warn('[enforceAllExpired] failed disabling pppoe', { tenantId, account: c.accountNumber, err: err?.message || err });
          }
        } else if (c.connectionType === 'static') {
          try {
            await disableCustomerQueue(c).catch(() => {});
            // release static IP back to pool (best-effort)
            try {
              const tenantDoc = await Tenant.findById(c.tenantId).lean();
              if (tenantDoc) await releaseIp(tenantDoc, c.staticConfig?.ip).catch(() => {});
            } catch (_) {}
            summary.static.disabled += 1;
          } catch (err) {
            summary.static.errors += 1;
            console.warn('[enforceAllExpired] failed disabling static', { tenantId, account: c.accountNumber, err: err?.message || err });
          }
        }
      } catch (err) {
        console.warn('[enforceAllExpired] failed to process expired customer', { id: c._id, err: err?.message || err });
      }
    }

    // Additionally, ensure any lingering disabled queues / lists are consistent
    // by scanning customers with status inactive/expired and re-applying disablement where necessary
    const inactiveList = await Customer.find({ status: { $in: ['inactive', 'expired'] } })
      .select('_id tenantId accountNumber accountAliases connectionType staticConfig')
      .lean()
      .catch(() => []);
    for (const c of inactiveList) {
      try {
        if (c.connectionType === 'pppoe') {
          await disablePppoeSecret(c).catch(() => {});
          await disableCustomerQueue(c).catch(() => {});
        } else if (c.connectionType === 'static') {
          await disableCustomerQueue(c).catch(() => {});
        }
      } catch (err) {
        // swallow
      }
    }

    return summary;
  } finally {
    await releaseLock('enforceAllExpired').catch(() => {});
  }
}

// schedule every 5 minutes
scheduleJob({ name: 'enforceAllExpired', cronExpr: '*/5 * * * *', task: runUnifiedEnforce });

module.exports = { runUnifiedEnforce };
