'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const Customer = require('../models/customers');
const Tenant = require('../models/Tenant');
const requirePortalAuth = require('../middleware/requirePortalAuth');
const {
  matchesCustomerCredential,
  normalizePortalAccountNumber,
  normalizePortalTenantLookup,
} = require('../services/customerPortalIdentity');
const { getPortalCustomer } = require('../services/customerPortalService');
const { signCustomerPortalAccessToken } = require('../utils/jwt');

const router = express.Router();

const LoginSchema = z
  .object({
    tenantName: z.string().min(1),
    accountNumber: z.string().min(1),
    credential: z.string().optional(),
    pin: z.string().optional(),
  })
  .refine((value) => value.credential || value.pin, {
    message: 'credential or pin is required',
    path: ['credential'],
  });

function exactMatchRegex(value) {
  const safe = String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${safe}$`, 'i');
}

async function resolvePortalCustomer({ tenantName, accountNumber }) {
  const tenantLookup = normalizePortalTenantLookup(tenantName);
  const normalizedAccountNumber = normalizePortalAccountNumber(accountNumber);
  const tenant = await Tenant.findOne({
    $or: [
      { name: exactMatchRegex(tenantLookup) },
      { subdomain: exactMatchRegex(tenantLookup) },
    ],
  }).lean();
  if (!tenant) return { tenant: null, customer: null };

  const customer = await Customer.findOne({
    tenantId: tenant._id,
    accountNumber: exactMatchRegex(normalizedAccountNumber),
  }).lean();

  return { tenant, customer };
}

router.post('/login', async (req, res) => {
  try {
    const parsed = LoginSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: 'Invalid payload' });
    }

    const { tenantName, accountNumber, credential, pin } = parsed.data;
    const { tenant, customer } = await resolvePortalCustomer({ tenantName, accountNumber });
    if (!tenant || !customer) {
      return res.status(401).json({ ok: false, error: 'Invalid portal credentials' });
    }
    if (customer.portalProfile?.isEnabled === false) {
      return res.status(403).json({ ok: false, error: 'Customer portal access is disabled' });
    }

    let authenticated = false;
    let loginMethod = null;

    if (customer.portalProfile?.pinHash && pin) {
      authenticated = await bcrypt.compare(pin, customer.portalProfile.pinHash);
      if (authenticated) loginMethod = 'pin';
    }

    if (!authenticated && credential) {
      authenticated = matchesCustomerCredential(customer, credential);
      if (authenticated) loginMethod = 'contact';
    }

    if (!authenticated) {
      return res.status(401).json({ ok: false, error: 'Invalid portal credentials' });
    }

    const hydratedCustomer = await getPortalCustomer(String(tenant._id), String(customer._id));
    const token = signCustomerPortalAccessToken({ tenant, customer: hydratedCustomer });

    await Customer.updateOne(
      { _id: customer._id, tenantId: tenant._id },
      {
        $set: {
          'portalProfile.lastLoginAt': new Date(),
          'portalProfile.lastLoginMethod': loginMethod,
          'portalProfile.lastSeenAt': new Date(),
        },
      }
    ).catch(() => null);

    return res.json({
      ok: true,
      token,
      user: {
        id: String(hydratedCustomer._id),
        displayName: hydratedCustomer.name || hydratedCustomer.accountNumber || 'Customer',
        email: hydratedCustomer.email || null,
        phone: hydratedCustomer.phone || null,
        accountNumber: hydratedCustomer.accountNumber || null,
        tenantName: tenant.name || null,
        role: 'customer',
      },
    });
  } catch (err) {
    console.error('portal login error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.get('/verify', requirePortalAuth, async (req, res) => {
  try {
    const customer = await getPortalCustomer(req.tenantId, req.portalCustomerId);
    await Customer.updateOne(
      { _id: customer._id, tenantId: req.tenantId },
      { $set: { 'portalProfile.lastSeenAt': new Date() } }
    ).catch(() => null);

    return res.json({
      ok: true,
      user: {
        id: String(customer._id),
        displayName: customer.name || customer.accountNumber || 'Customer',
        email: customer.email || null,
        phone: customer.phone || null,
        accountNumber: customer.accountNumber || null,
        tenantName: req.user?.tenantName || null,
        role: 'customer',
      },
    });
  } catch (err) {
    return res.status(err?.statusCode || 401).json({ ok: false, error: err?.message || 'Invalid portal session' });
  }
});

router.post('/logout', (_req, res) => {
  return res.json({ ok: true });
});

module.exports = router;
