'use strict';

const { readBearerToken } = require('./bearerToken');
const { verifyCustomerPortalAccessToken } = require('../utils/jwt');
const Customer = require('../models/customers');

module.exports = async function requirePortalAuth(req, res, next) {
  if (req.method === 'OPTIONS') return res.sendStatus(204);

  const token = readBearerToken(req);

  if (!token) {
    return res.status(401).json({ ok: false, error: 'Missing portal token' });
  }

  try {
    const claims = verifyCustomerPortalAccessToken(token);
    const customer = await Customer.findOne({ _id: claims.sub, tenantId: claims.tenantId })
      .select('portalProfile').lean();
    if (!customer || customer.portalProfile?.isEnabled === false || !customer.portalProfile?.pinHash ||
      Number(customer.portalProfile?.sessionVersion || 0) !== Number(claims.sessionVersion || 0)) {
      return res.status(401).json({ ok: false, error: 'Portal session revoked. Sign in again.' });
    }
    req.user = claims;
    req.authRealm = 'customer-portal';
    req.authToken = token;
    req.portalCustomerId = String(claims.sub);
    req.tenantId = String(claims.tenantId);
    return next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: 'Invalid or expired portal token' });
  }
};
